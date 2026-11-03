package services

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Network map v1 — static intent graph from NetworkPolicy + workload pod templates.
// Edges mean "policy allows traffic in this direction", not observed flows.

type NetworkMapNode struct {
	ID          string            `json:"id"`
	Kind        string            `json:"kind"` // Deployment | StatefulSet | DaemonSet | CIDR | Namespace
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	OpenIngress bool              `json:"openIngress,omitempty"` // allow from anywhere (no peer / 0.0.0.0/0)
	OpenEgress  bool              `json:"openEgress,omitempty"`  // allow to anywhere
}

type NetworkMapEdge struct {
	ID       string `json:"id"`
	From     string `json:"from"`
	To       string `json:"to"`
	Dir      string `json:"dir"` // ingress | egress
	Ports    string `json:"ports,omitempty"`
	Policy   string `json:"policy"`
	PolicyNS string `json:"policyNamespace"`
}

type NetworkMap struct {
	Nodes     []NetworkMapNode `json:"nodes"`
	Edges     []NetworkMapEdge `json:"edges"`
	Policies  int              `json:"policies"`
	Workloads int              `json:"workloads"`
	Namespace string           `json:"namespace,omitempty"` // filter applied (empty = all)
	Note      string           `json:"note,omitempty"`
}

type workload struct {
	id        string
	kind      string
	name      string
	namespace string
	labels    map[string]string
}

func ListNetworkMap(ctx context.Context, k8sCfg *rest.Config, namespace string) (*NetworkMap, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create k8s client: %w", err)
	}

	nsFilter := strings.TrimSpace(namespace)
	// Always load cluster workloads so cross-namespace peers resolve; NP list
	// is scoped by namespace query when set.
	workloads, err := listMapWorkloads(ctx, client, "")
	if err != nil {
		return nil, err
	}

	npNS := nsFilter
	nps, err := client.NetworkingV1().NetworkPolicies(npNS).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list networkpolicies: %w", err)
	}

	nsList, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list namespaces: %w", err)
	}
	nsByName := map[string]corev1.Namespace{}
	for i := range nsList.Items {
		ns := nsList.Items[i]
		nsByName[ns.Name] = ns
	}

	nodes := map[string]NetworkMapNode{}
	// Seed with workloads in scope (filtered ns, or all).
	scopedWorkloadCount := 0
	for _, w := range workloads {
		if nsFilter != "" && w.namespace != nsFilter {
			continue
		}
		scopedWorkloadCount++
		nodes[w.id] = NetworkMapNode{
			ID: w.id, Kind: w.kind, Name: w.name, Namespace: w.namespace, Labels: w.labels,
		}
	}

	byID := map[string]workload{}
	for _, w := range workloads {
		byID[w.id] = w
	}

	edges := make([]NetworkMapEdge, 0)
	edgeKeys := map[string]struct{}{}

	ensureNode := func(n NetworkMapNode) {
		if existing, ok := nodes[n.ID]; ok {
			// Preserve open flags when re-ensuring a node.
			if n.OpenIngress {
				existing.OpenIngress = true
			}
			if n.OpenEgress {
				existing.OpenEgress = true
			}
			if n.Name != "" {
				existing.Name = n.Name
			}
			nodes[n.ID] = existing
			return
		}
		nodes[n.ID] = n
	}

	markOpen := func(id string, ingress, egress bool) {
		n, ok := nodes[id]
		if !ok {
			if w, wok := byID[id]; wok {
				n = NetworkMapNode{
					ID: w.id, Kind: w.kind, Name: w.name, Namespace: w.namespace, Labels: w.labels,
				}
			} else {
				return
			}
		}
		if ingress {
			n.OpenIngress = true
		}
		if egress {
			n.OpenEgress = true
		}
		nodes[id] = n
	}

	ensureEndpoint := func(id string) {
		if id == "" {
			return
		}
		if _, ok := nodes[id]; ok {
			return
		}
		if w, ok := byID[id]; ok {
			ensureNode(NetworkMapNode{
				ID: w.id, Kind: w.kind, Name: w.name, Namespace: w.namespace, Labels: w.labels,
			})
		}
	}

	addEdge := func(from, to, dir, ports, policy, policyNS string) {
		if from == "" || to == "" || from == to {
			return
		}
		ensureEndpoint(from)
		ensureEndpoint(to)
		key := from + "|" + to + "|" + dir + "|" + ports + "|" + policyNS + "/" + policy
		if _, ok := edgeKeys[key]; ok {
			return
		}
		edgeKeys[key] = struct{}{}
		edges = append(edges, NetworkMapEdge{
			ID:   fmt.Sprintf("e%d", len(edges)+1),
			From: from, To: to, Dir: dir, Ports: ports,
			Policy: policy, PolicyNS: policyNS,
		})
	}

	for _, np := range nps.Items {
		targets := matchWorkloads(workloads, np.Namespace, np.Spec.PodSelector)
		if len(targets) == 0 {
			continue
		}

		types := policyTypes(np)
		portsAll := "all ports"

		if types["Ingress"] {
			rules := np.Spec.Ingress
			if len(rules) == 0 {
				// Deny-all ingress: no allow edges (targets stay as isolated nodes).
			} else {
				for _, rule := range rules {
					ports := formatPorts(rule.Ports)
					if ports == "" {
						ports = portsAll
					}
					peers := rule.From
					if len(peers) == 0 {
						// Empty From = allow from anywhere — badge, not a hub node
						// (a World hub with dozens of edges looks broken in the UI).
						for _, t := range targets {
							markOpen(t.id, true, false)
						}
						continue
					}
					for _, peer := range peers {
						if isAnywhereIPBlock(peer) {
							for _, t := range targets {
								markOpen(t.id, true, false)
							}
							continue
						}
						srcs := resolvePeer(peer, np.Namespace, workloads, nsByName, ensureNode)
						for _, s := range srcs {
							for _, t := range targets {
								addEdge(s, t.id, "ingress", ports, np.Name, np.Namespace)
							}
						}
					}
				}
			}
		}

		if types["Egress"] {
			rules := np.Spec.Egress
			if len(rules) == 0 {
				// Deny-all egress.
			} else {
				for _, rule := range rules {
					ports := formatPorts(rule.Ports)
					if ports == "" {
						ports = portsAll
					}
					peers := rule.To
					if len(peers) == 0 {
						for _, t := range targets {
							markOpen(t.id, false, true)
						}
						continue
					}
					for _, peer := range peers {
						if isAnywhereIPBlock(peer) {
							for _, t := range targets {
								markOpen(t.id, false, true)
							}
							continue
						}
						dsts := resolvePeer(peer, np.Namespace, workloads, nsByName, ensureNode)
						for _, t := range targets {
							for _, d := range dsts {
								addEdge(t.id, d, "egress", ports, np.Name, np.Namespace)
							}
						}
					}
				}
			}
		}
	}

	outNodes := make([]NetworkMapNode, 0, len(nodes))
	for _, n := range nodes {
		outNodes = append(outNodes, n)
	}
	sort.Slice(outNodes, func(i, j int) bool {
		if outNodes[i].Namespace != outNodes[j].Namespace {
			return outNodes[i].Namespace < outNodes[j].Namespace
		}
		if outNodes[i].Kind != outNodes[j].Kind {
			return outNodes[i].Kind < outNodes[j].Kind
		}
		return outNodes[i].Name < outNodes[j].Name
	})
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].From != edges[j].From {
			return edges[i].From < edges[j].From
		}
		return edges[i].To < edges[j].To
	})

	note := ""
	if len(nps.Items) == 0 {
		note = "No NetworkPolicies in scope — showing workloads only. Edges appear when policies allow traffic."
	} else if len(edges) == 0 {
		note = "NetworkPolicies present, but no allow rules matched workloads (deny-all or selectors miss)."
	}

	return &NetworkMap{
		Nodes:     outNodes,
		Edges:     edges,
		Policies:  len(nps.Items),
		Workloads: scopedWorkloadCount,
		Namespace: nsFilter,
		Note:      note,
	}, nil
}

func listMapWorkloads(ctx context.Context, client kubernetes.Interface, ns string) ([]workload, error) {
	var out []workload

	deps, err := client.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	for _, d := range deps.Items {
		out = append(out, workload{
			id:   workloadID("Deployment", d.Namespace, d.Name),
			kind: "Deployment", name: d.Name, namespace: d.Namespace,
			labels: d.Spec.Template.Labels,
		})
	}

	stss, err := client.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list statefulsets: %w", err)
	}
	for _, ss := range stss.Items {
		out = append(out, workload{
			id:   workloadID("StatefulSet", ss.Namespace, ss.Name),
			kind: "StatefulSet", name: ss.Name, namespace: ss.Namespace,
			labels: ss.Spec.Template.Labels,
		})
	}

	dss, err := client.AppsV1().DaemonSets(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list daemonsets: %w", err)
	}
	for _, ds := range dss.Items {
		out = append(out, workload{
			id:   workloadID("DaemonSet", ds.Namespace, ds.Name),
			kind: "DaemonSet", name: ds.Name, namespace: ds.Namespace,
			labels: ds.Spec.Template.Labels,
		})
	}

	return out, nil
}

func workloadID(kind, ns, name string) string {
	return kind + "/" + ns + "/" + name
}

func policyTypes(np networkingv1.NetworkPolicy) map[string]bool {
	out := map[string]bool{}
	if len(np.Spec.PolicyTypes) == 0 {
		out["Ingress"] = true
		if len(np.Spec.Egress) > 0 {
			out["Egress"] = true
		}
		return out
	}
	for _, t := range np.Spec.PolicyTypes {
		out[string(t)] = true
	}
	return out
}

func matchWorkloads(all []workload, ns string, sel metav1.LabelSelector) []workload {
	selector, err := metav1.LabelSelectorAsSelector(&sel)
	if err != nil {
		return nil
	}
	var matched []workload
	for _, w := range all {
		if w.namespace != ns {
			continue
		}
		if selector.Empty() || selector.Matches(labels.Set(w.labels)) {
			matched = append(matched, w)
		}
	}
	return matched
}

func isAnywhereIPBlock(peer networkingv1.NetworkPolicyPeer) bool {
	if peer.IPBlock == nil {
		return false
	}
	cidr := strings.TrimSpace(peer.IPBlock.CIDR)
	return cidr == "0.0.0.0/0" || cidr == "::/0"
}

func resolvePeer(
	peer networkingv1.NetworkPolicyPeer,
	policyNS string,
	workloads []workload,
	nsByName map[string]corev1.Namespace,
	ensure func(NetworkMapNode),
) []string {
	if peer.IPBlock != nil {
		cidr := peer.IPBlock.CIDR
		id := "cidr/" + cidr
		ensure(NetworkMapNode{ID: id, Kind: "CIDR", Name: cidr})
		return []string{id}
	}

	var nsNames []string
	if peer.NamespaceSelector != nil {
		sel, err := metav1.LabelSelectorAsSelector(peer.NamespaceSelector)
		if err != nil {
			return nil
		}
		for name, ns := range nsByName {
			if sel.Empty() || sel.Matches(labels.Set(ns.Labels)) {
				nsNames = append(nsNames, name)
			}
		}
		sort.Strings(nsNames)
	} else {
		nsNames = []string{policyNS}
	}

	if peer.PodSelector == nil && peer.NamespaceSelector != nil {
		// Namespace-only peer: synthetic namespace nodes (avoid exploding edges).
		var ids []string
		for _, name := range nsNames {
			id := "namespace/" + name
			ensure(NetworkMapNode{ID: id, Kind: "Namespace", Name: name, Namespace: name})
			ids = append(ids, id)
		}
		return ids
	}

	podSel := metav1.LabelSelector{}
	if peer.PodSelector != nil {
		podSel = *peer.PodSelector
	}
	selector, err := metav1.LabelSelectorAsSelector(&podSel)
	if err != nil {
		return nil
	}

	var ids []string
	seen := map[string]struct{}{}
	nsSet := map[string]struct{}{}
	for _, n := range nsNames {
		nsSet[n] = struct{}{}
	}
	for _, w := range workloads {
		if _, ok := nsSet[w.namespace]; !ok {
			continue
		}
		if selector.Empty() || selector.Matches(labels.Set(w.labels)) {
			if _, ok := seen[w.id]; ok {
				continue
			}
			seen[w.id] = struct{}{}
			ids = append(ids, w.id)
		}
	}
	return ids
}

func formatPorts(ports []networkingv1.NetworkPolicyPort) string {
	if len(ports) == 0 {
		return ""
	}
	parts := make([]string, 0, len(ports))
	for _, p := range ports {
		proto := "TCP"
		if p.Protocol != nil {
			proto = string(*p.Protocol)
		}
		port := "all"
		if p.Port != nil {
			port = p.Port.String()
		}
		if p.EndPort != nil {
			parts = append(parts, fmt.Sprintf("%s/%s-%d", proto, port, *p.EndPort))
		} else {
			parts = append(parts, fmt.Sprintf("%s/%s", proto, port))
		}
	}
	return strings.Join(parts, ", ")
}
