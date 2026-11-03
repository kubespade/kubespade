package services

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	watchpkg "k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type NodeInfo struct {
	Name           string `json:"name"`
	Status         string `json:"status"`
	Role           string `json:"role"`
	Version        string `json:"version"`
	InternalIP     string `json:"internalIP"`
	OS             string `json:"os"`
	InstanceType   string `json:"instanceType"`
	Zone           string `json:"zone"`
	Lifecycle      string `json:"lifecycle"` // Spot / On-Demand / Preemptible; empty if unknown
	CPUCap         string `json:"cpuCap"`
	MemCap         string `json:"memCap"`
	CPUAlloc       string `json:"cpuAlloc"`
	MemAlloc       string `json:"memAlloc"`
	CPUAllocMilli  int64  `json:"cpuAllocMilli"`
	MemAllocBytes  int64  `json:"memAllocBytes"`
	DiskAlloc      string `json:"diskAlloc"`
	DiskAllocBytes int64  `json:"diskAllocBytes"`
	Unschedulable  bool   `json:"unschedulable"`
	WorkloadPods   int    `json:"workloadPods"` // evictable pods on node (excl. DaemonSet / mirror)
	Taints         int    `json:"taints"`
	TaintsDetail   string `json:"taintsDetail"`
	Age            int64  `json:"age"` // Unix seconds of CreationTimestamp
}

func formatStorage(bytes int64) string {
	const Ti = int64(1) << 40
	const Gi = int64(1) << 30
	const Mi = int64(1) << 20
	switch {
	case bytes >= Ti:
		return fmt.Sprintf("%.1fTi", float64(bytes)/float64(Ti))
	case bytes >= Gi:
		return fmt.Sprintf("%.0fGi", float64(bytes)/float64(Gi))
	default:
		return fmt.Sprintf("%.0fMi", float64(bytes)/float64(Mi))
	}
}

func formatTaints(taints []corev1.Taint) string {
	parts := make([]string, 0, len(taints))
	for _, t := range taints {
		if t.Value != "" {
			parts = append(parts, fmt.Sprintf("%s=%s:%s", t.Key, t.Value, t.Effect))
		} else {
			parts = append(parts, fmt.Sprintf("%s:%s", t.Key, t.Effect))
		}
	}
	return strings.Join(parts, "\n")
}

type EventInfo struct {
	Message  string `json:"message"`
	Object   string `json:"object"`
	Reason   string `json:"reason"`
	Type     string `json:"type"`
	Count    int32  `json:"count"`
	LastTime int64  `json:"lastTime"` // Unix seconds
}

type ResourceStat struct {
	Usage       float64 `json:"usage"`
	Requests    float64 `json:"requests"`
	Limits      float64 `json:"limits"`
	Allocatable float64 `json:"allocatable"`
}

type ClusterMetrics struct {
	CPU        ResourceStat `json:"cpu"`    // cores
	Memory     ResourceStat `json:"memory"` // GiB
	Pods       ResourceStat `json:"pods"`   // count
	HasMetrics bool         `json:"hasMetrics"`
}

type ClusterInfo struct {
	Name       string          `json:"name"`
	Version    string          `json:"version"`
	NodeCount  int             `json:"nodeCount"`
	ReadyNodes int             `json:"readyNodes"`
	Nodes      []NodeInfo      `json:"nodes"`
	Namespaces []string        `json:"namespaces"`
	Events     []EventInfo     `json:"events"`
	Metrics    *ClusterMetrics `json:"metrics,omitempty"`
}

func GetClusterInfo(ctx context.Context, k8sCfg *rest.Config, clusterName string) (*ClusterInfo, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create k8s client: %w", err)
	}

	var (
		version  string
		nodeList *corev1.NodeList
		nsList   *corev1.NamespaceList
		podList  *corev1.PodList
		verErr   error
		nodeErr  error
		nsErr    error
		podErr   error
	)
	var wg sync.WaitGroup
	wg.Add(4)
	go func() {
		defer wg.Done()
		v, e := client.Discovery().ServerVersion()
		if e != nil {
			verErr = e
			return
		}
		version = v.GitVersion
	}()
	go func() {
		defer wg.Done()
		nodeList, nodeErr = client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	}()
	go func() {
		defer wg.Done()
		nsList, nsErr = client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	}()
	go func() {
		defer wg.Done()
		podList, podErr = client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	}()
	wg.Wait()
	if verErr != nil {
		return nil, fmt.Errorf("server version: %w", verErr)
	}
	if nodeErr != nil {
		return nil, fmt.Errorf("list nodes: %w", nodeErr)
	}
	if nsErr != nil {
		return nil, fmt.Errorf("list namespaces: %w", nsErr)
	}
	if podErr != nil {
		return nil, fmt.Errorf("list pods: %w", podErr)
	}

	workloadByNode := WorkloadPodsByNode(podList.Items)

	nodes := make([]NodeInfo, 0, len(nodeList.Items))
	readyNodes := 0
	for _, n := range nodeList.Items {
		ni := nodeToInfo(n, workloadByNode[n.Name])
		nodes = append(nodes, ni)
		if ni.Status == "Ready" {
			readyNodes++
		}
	}

	namespaces := make([]string, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		namespaces = append(namespaces, ns.Name)
	}

	events := fetchEvents(ctx, client)
	if events == nil {
		events = []EventInfo{}
	}
	metrics := fetchMetrics(ctx, client, nodeList.Items)

	return &ClusterInfo{
		Name:       clusterName,
		Version:    version,
		NodeCount:  len(nodes),
		ReadyNodes: readyNodes,
		Nodes:      nodes,
		Namespaces: namespaces,
		Events:     events,
		Metrics:    metrics,
	}, nil
}

func nodeToInfo(n corev1.Node, workloadPods int) NodeInfo {
	internalIP := ""
	for _, addr := range n.Status.Addresses {
		if addr.Type == corev1.NodeInternalIP {
			internalIP = addr.Address
			break
		}
	}
	instanceType := n.Labels["node.kubernetes.io/instance-type"]
	if instanceType == "" {
		instanceType = n.Labels["beta.kubernetes.io/instance-type"]
	}
	zone := n.Labels["topology.kubernetes.io/zone"]
	if zone == "" {
		zone = n.Labels["failure-domain.beta.kubernetes.io/zone"]
	}
	cpuCap := ""
	if cpu, ok := n.Status.Capacity[corev1.ResourceCPU]; ok {
		cpuCap = fmt.Sprintf("%d", cpu.Value())
	}
	memCap := ""
	if mem, ok := n.Status.Capacity[corev1.ResourceMemory]; ok {
		gi := float64(mem.Value()) / (1 << 30)
		memCap = fmt.Sprintf("%.0fGi", gi)
	}
	cpuAlloc := ""
	cpuAllocMilli := int64(0)
	if cpu, ok := n.Status.Allocatable[corev1.ResourceCPU]; ok {
		cpuAllocMilli = cpu.MilliValue()
		cpuAlloc = fmt.Sprintf("%d", cpu.Value())
	}
	memAlloc := ""
	memAllocBytes := int64(0)
	if mem, ok := n.Status.Allocatable[corev1.ResourceMemory]; ok {
		memAllocBytes = mem.Value()
		gi := float64(memAllocBytes) / (1 << 30)
		memAlloc = fmt.Sprintf("%.1fGi", gi)
	}
	diskAlloc := ""
	diskAllocBytes := int64(0)
	if disk, ok := n.Status.Capacity[corev1.ResourceEphemeralStorage]; ok {
		diskAllocBytes = disk.Value()
		diskAlloc = formatStorage(diskAllocBytes)
	}
	return NodeInfo{
		Name:           n.Name,
		Status:         nodeStatus(n),
		Role:           nodeRole(n),
		Version:        n.Status.NodeInfo.KubeletVersion,
		InternalIP:     internalIP,
		OS:             n.Status.NodeInfo.OSImage,
		InstanceType:   instanceType,
		Zone:           zone,
		Lifecycle:      nodeLifecycle(n),
		CPUCap:         cpuCap,
		MemCap:         memCap,
		CPUAlloc:       cpuAlloc,
		MemAlloc:       memAlloc,
		CPUAllocMilli:  cpuAllocMilli,
		MemAllocBytes:  memAllocBytes,
		DiskAlloc:      diskAlloc,
		DiskAllocBytes: diskAllocBytes,
		Unschedulable:  n.Spec.Unschedulable,
		WorkloadPods:   workloadPods,
		Taints:         len(n.Spec.Taints),
		TaintsDetail:   formatTaints(n.Spec.Taints),
		Age:            n.CreationTimestamp.Unix(),
	}
}

// nodeLifecycle returns a short capacity lifecycle label (Spot / On-Demand / …)
// from common cloud / Karpenter node labels. Empty when unknown.
func nodeLifecycle(n corev1.Node) string {
	labels := n.Labels
	if len(labels) == 0 {
		return ""
	}
	if v := labels["eks.amazonaws.com/capacityType"]; v != "" {
		return normalizeNodeLifecycle(v)
	}
	if v := labels["karpenter.sh/capacity-type"]; v != "" {
		return normalizeNodeLifecycle(v)
	}
	if labels["cloud.google.com/gke-spot"] == "true" {
		return "Spot"
	}
	if labels["cloud.google.com/gke-preemptible"] == "true" {
		return "Preemptible"
	}
	if v := labels["kubernetes.azure.com/scalesetpriority"]; v != "" {
		return normalizeNodeLifecycle(v)
	}
	if v := labels["node.kubernetes.io/lifecycle"]; v != "" {
		return normalizeNodeLifecycle(v)
	}
	if v := labels["node.kubernetes.io/instance-lifecycle"]; v != "" {
		return normalizeNodeLifecycle(v)
	}
	if v := labels["lifecycle"]; strings.EqualFold(v, "Ec2Spot") || strings.EqualFold(v, "spot") {
		return "Spot"
	}
	return ""
}

func normalizeNodeLifecycle(raw string) string {
	key := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), "_", "-"))
	switch key {
	case "spot", "ec2spot":
		return "Spot"
	case "on-demand", "ondemand", "regular":
		return "On-Demand"
	case "preemptible":
		return "Preemptible"
	case "capacity-block", "capacityblock":
		return "Capacity Block"
	default:
		return raw
	}
}

func nodeStatus(n corev1.Node) string {
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			if c.Status == corev1.ConditionTrue {
				return "Ready"
			}
			return "NotReady"
		}
	}
	return "Unknown"
}

func nodeRole(n corev1.Node) string {
	if _, ok := n.Labels["node-role.kubernetes.io/control-plane"]; ok {
		return "control-plane"
	}
	if _, ok := n.Labels["node-role.kubernetes.io/master"]; ok {
		return "master"
	}
	return "worker"
}

// fetchMetrics collects CPU/Memory/Pod stats.
// Usage is fetched from metrics-server if available; allocatable is always from node specs.
func fetchMetrics(ctx context.Context, client *kubernetes.Clientset, nodes []corev1.Node) *ClusterMetrics {
	m := &ClusterMetrics{}

	// Allocatable totals from node specs (always available).
	var allocCPU, allocMemBytes, allocPods float64
	for _, n := range nodes {
		if q, ok := n.Status.Allocatable[corev1.ResourceCPU]; ok {
			allocCPU += quantityCores(q)
		}
		if q, ok := n.Status.Allocatable[corev1.ResourceMemory]; ok {
			allocMemBytes += quantityBytes(q)
		}
		if q, ok := n.Status.Allocatable[corev1.ResourcePods]; ok {
			allocPods += float64(q.Value())
		}
	}
	m.CPU.Allocatable = allocCPU
	m.Memory.Allocatable = allocMemBytes / (1 << 30) // → GiB
	m.Pods.Allocatable = allocPods

	// Running pod count + sum requests/limits (best-effort; requires list-pods permission).
	if podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "status.phase=Running",
	}); err == nil {
		m.Pods.Usage = float64(len(podList.Items))
		for _, pod := range podList.Items {
			for _, c := range pod.Spec.Containers {
				if q, ok := c.Resources.Requests[corev1.ResourceCPU]; ok {
					m.CPU.Requests += quantityCores(q)
				}
				if q, ok := c.Resources.Requests[corev1.ResourceMemory]; ok {
					m.Memory.Requests += quantityBytes(q) / (1 << 30)
				}
				if q, ok := c.Resources.Limits[corev1.ResourceCPU]; ok {
					m.CPU.Limits += quantityCores(q)
				}
				if q, ok := c.Resources.Limits[corev1.ResourceMemory]; ok {
					m.Memory.Limits += quantityBytes(q) / (1 << 30)
				}
			}
		}
	}

	// Try metrics-server for CPU/Memory usage.
	raw, err := client.RESTClient().Get().
		AbsPath("/apis/metrics.k8s.io/v1beta1/nodes").
		DoRaw(ctx)
	if err != nil {
		return m // no metrics-server — return allocatable-only
	}

	var resp nodeMetricsList
	if json.Unmarshal(raw, &resp) != nil {
		return m
	}

	var usageCPU, usageMemBytes float64
	for _, item := range resp.Items {
		cpuMilli, memBytes := parseMetricsUsage(item.Usage.CPU, item.Usage.Memory)
		usageCPU += float64(cpuMilli) / 1000
		usageMemBytes += float64(memBytes)
	}
	m.CPU.Usage = usageCPU
	m.Memory.Usage = usageMemBytes / (1 << 30) // → GiB
	m.HasMetrics = true
	return m
}

func quantityCores(q resource.Quantity) float64 {
	return float64(q.MilliValue()) / 1000
}

func quantityBytes(q resource.Quantity) float64 {
	return float64(q.Value())
}

func fetchEvents(ctx context.Context, client *kubernetes.Clientset) []EventInfo {
	list, err := client.CoreV1().Events("").List(ctx, metav1.ListOptions{
		FieldSelector: "type=Warning",
		Limit:         50,
	})
	if err != nil {
		// Some clusters reject fieldSelector; fall back to a full list and filter.
		all, err2 := client.CoreV1().Events("").List(ctx, metav1.ListOptions{Limit: 200})
		if err2 != nil {
			// nil = caller should keep any previous snapshot (don't wipe Overview Warnings).
			return nil
		}
		filtered := make([]corev1.Event, 0)
		for _, e := range all.Items {
			if e.Type == corev1.EventTypeWarning {
				filtered = append(filtered, e)
			}
		}
		list = &corev1.EventList{Items: filtered}
	}
	sort.Slice(list.Items, func(i, j int) bool {
		ti, tj := eventTime(list.Items[i]), eventTime(list.Items[j])
		return ti.After(tj)
	})
	if len(list.Items) > 50 {
		list.Items = list.Items[:50]
	}
	result := make([]EventInfo, 0, len(list.Items))
	for _, e := range list.Items {
		obj := e.InvolvedObject.Name
		if e.InvolvedObject.Kind != "" {
			obj = e.InvolvedObject.Kind + "/" + e.InvolvedObject.Name
		}
		if e.InvolvedObject.Namespace != "" {
			obj = e.InvolvedObject.Namespace + "/" + obj
		}
		result = append(result, EventInfo{
			Message:  e.Message,
			Object:   obj,
			Reason:   e.Reason,
			Type:     string(e.Type),
			Count:    e.Count,
			LastTime: eventTime(e).Unix(),
		})
	}
	return result
}

func eventTime(e corev1.Event) time.Time {
	if !e.LastTimestamp.IsZero() {
		return e.LastTimestamp.Time
	}
	if e.EventTime.IsZero() {
		return e.CreationTimestamp.Time
	}
	return e.EventTime.Time
}

// clusterWatch holds the mutable state accumulated while streaming a cluster.
type clusterWatch struct {
	client      *kubernetes.Clientset
	clusterName string
	k8sVersion  string
	nodesMap    map[string]corev1.Node
	nsSet       map[string]bool
	podsMap     map[string]corev1.Pod
	events      []EventInfo
	metrics     *ClusterMetrics
	lastRefresh time.Time
}

// snapshot builds the current ClusterInfo, refreshing events/metrics at most once
// per 5s (previous values are kept if a refresh fails).
func (w *clusterWatch) snapshot(ctx context.Context) ClusterInfo {
	podSlice := make([]corev1.Pod, 0, len(w.podsMap))
	for _, p := range w.podsMap {
		podSlice = append(podSlice, p)
	}
	workloadByNode := WorkloadPodsByNode(podSlice)
	nodes := make([]NodeInfo, 0, len(w.nodesMap))
	readyNodes := 0
	rawNodes := make([]corev1.Node, 0, len(w.nodesMap))
	for _, n := range w.nodesMap {
		ni := nodeToInfo(n, workloadByNode[n.Name])
		nodes = append(nodes, ni)
		rawNodes = append(rawNodes, n)
		if ni.Status == "Ready" {
			readyNodes++
		}
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	namespaces := make([]string, 0, len(w.nsSet))
	for ns := range w.nsSet {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)

	// Refresh metrics every 5s. Keep previous events if the refresh fails.
	if time.Since(w.lastRefresh) >= 5*time.Second {
		if next := fetchEvents(ctx, w.client); next != nil {
			w.events = next
		}
		w.metrics = fetchMetrics(ctx, w.client, rawNodes)
		w.lastRefresh = time.Now()
	}

	return ClusterInfo{
		Name:       w.clusterName,
		Version:    w.k8sVersion,
		NodeCount:  len(nodes),
		ReadyNodes: readyNodes,
		Nodes:      nodes,
		Namespaces: namespaces,
		Events:     w.events,
		Metrics:    w.metrics,
	}
}

// runWatchers drives the live node/pod/namespace watchers plus the periodic
// metrics/events refresh, emitting a full snapshot on every change.
func (w *clusterWatch) runWatchers(ctx context.Context, nodeRV, nsRV, podRV string, send func(any) bool) error {
	nodeWatcher, err := w.client.CoreV1().Nodes().Watch(ctx, metav1.ListOptions{ResourceVersion: nodeRV})
	if err != nil {
		return fmt.Errorf("watch nodes: %w", err)
	}
	defer nodeWatcher.Stop()

	nsWatcher, err := w.client.CoreV1().Namespaces().Watch(ctx, metav1.ListOptions{ResourceVersion: nsRV})
	if err != nil {
		return fmt.Errorf("watch namespaces: %w", err)
	}
	defer nsWatcher.Stop()

	podWatcher, err := w.client.CoreV1().Pods("").Watch(ctx, metav1.ListOptions{ResourceVersion: podRV})
	if err != nil {
		return fmt.Errorf("watch pods: %w", err)
	}
	defer podWatcher.Stop()

	// Ticker drives periodic metrics + events refresh.
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			w.lastRefresh = time.Time{} // force refresh on next snapshot()
			if !send(map[string]any{"type": "info", "phase": "full", "data": w.snapshot(ctx)}) {
				return nil
			}
		case event, ok := <-nodeWatcher.ResultChan():
			if !ok {
				return fmt.Errorf("node watch closed")
			}
			node, ok := event.Object.(*corev1.Node)
			if !ok {
				continue
			}
			switch event.Type {
			case watchpkg.Added, watchpkg.Modified:
				w.nodesMap[node.Name] = *node
			case watchpkg.Deleted:
				delete(w.nodesMap, node.Name)
			}
			if !send(map[string]any{"type": "info", "phase": "full", "data": w.snapshot(ctx)}) {
				return nil
			}
		case event, ok := <-podWatcher.ResultChan():
			if !ok {
				return fmt.Errorf("pod watch closed")
			}
			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}
			key := pod.Namespace + "/" + pod.Name
			switch event.Type {
			case watchpkg.Added, watchpkg.Modified:
				w.podsMap[key] = *pod
			case watchpkg.Deleted:
				delete(w.podsMap, key)
			}
			if !send(map[string]any{"type": "info", "phase": "full", "data": w.snapshot(ctx)}) {
				return nil
			}
		case event, ok := <-nsWatcher.ResultChan():
			if !ok {
				return fmt.Errorf("namespace watch closed")
			}
			ns, ok := event.Object.(*corev1.Namespace)
			if !ok {
				continue
			}
			switch event.Type {
			case watchpkg.Added:
				w.nsSet[ns.Name] = true
			case watchpkg.Deleted:
				delete(w.nsSet, ns.Name)
			}
			if !send(map[string]any{"type": "info", "phase": "full", "data": w.snapshot(ctx)}) {
				return nil
			}
		}
	}
}

// WatchCluster streams real-time cluster state via the Kubernetes Watch API.
func WatchCluster(ctx context.Context, k8sCfg *rest.Config, clusterName string, send func(any) bool) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}

	// Phase 1a — version + namespaces first (namespace picker / header on slow links).
	// Phase 1b — nodes (same fan-out; emit as soon as each stage is ready).
	type verResult struct {
		version string
		err     error
	}
	type nsResult struct {
		list *corev1.NamespaceList
		err  error
	}
	type nodeResult struct {
		list *corev1.NodeList
		err  error
	}
	verCh := make(chan verResult, 1)
	nsCh := make(chan nsResult, 1)
	nodeCh := make(chan nodeResult, 1)
	go func() {
		v, e := client.Discovery().ServerVersion()
		if e != nil {
			verCh <- verResult{err: e}
			return
		}
		verCh <- verResult{version: v.GitVersion}
	}()
	go func() {
		list, e := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
		nsCh <- nsResult{list: list, err: e}
	}()
	go func() {
		list, e := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		nodeCh <- nodeResult{list: list, err: e}
	}()

	var k8sVersion string
	var nsList *corev1.NamespaceList
	var nodeList *corev1.NodeList
	gotVer, gotNs, gotNodes := false, false, false
	for !gotVer || !gotNs || !gotNodes {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case r := <-verCh:
			if r.err != nil {
				return fmt.Errorf("server version: %w", r.err)
			}
			k8sVersion = r.version
			gotVer = true
		case r := <-nsCh:
			if r.err != nil {
				return fmt.Errorf("list namespaces: %w", r.err)
			}
			nsList = r.list
			gotNs = true
		case r := <-nodeCh:
			if r.err != nil {
				return fmt.Errorf("list nodes: %w", r.err)
			}
			nodeList = r.list
			gotNodes = true
		}
		if gotVer && gotNs && !gotNodes {
			namespaces := make([]string, 0, len(nsList.Items))
			for _, ns := range nsList.Items {
				namespaces = append(namespaces, ns.Name)
			}
			sort.Strings(namespaces)
			if !send(map[string]any{
				"type":  "info",
				"phase": "light",
				"data": ClusterInfo{
					Name:       clusterName,
					Version:    k8sVersion,
					NodeCount:  0,
					ReadyNodes: 0,
					Nodes:      []NodeInfo{},
					Namespaces: namespaces,
					Events:     []EventInfo{},
				},
			}) {
				return nil
			}
		}
	}

	w := &clusterWatch{
		client:      client,
		clusterName: clusterName,
		k8sVersion:  k8sVersion,
		nodesMap:    make(map[string]corev1.Node, len(nodeList.Items)),
		nsSet:       make(map[string]bool, len(nsList.Items)),
		podsMap:     make(map[string]corev1.Pod),
		events:      []EventInfo{},
		// Now() so the light snapshot() does not fetch events/metrics yet.
		lastRefresh: time.Now(),
	}
	for _, n := range nodeList.Items {
		w.nodesMap[n.Name] = n
	}
	for _, ns := range nsList.Items {
		w.nsSet[ns.Name] = true
	}

	// Light with nodes (still no pods / metrics).
	light := w.snapshot(ctx)
	light.Events = []EventInfo{}
	light.Metrics = nil
	if !send(map[string]any{"type": "info", "phase": "light", "data": light}) {
		return nil
	}

	// Phase 2 — all pods + events + metrics, then live watchers.
	podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("list pods: %w", err)
	}
	for _, p := range podList.Items {
		w.podsMap[p.Namespace+"/"+p.Name] = p
	}
	w.lastRefresh = time.Time{} // force events + metrics on full snapshot
	if !send(map[string]any{"type": "info", "phase": "full", "data": w.snapshot(ctx)}) {
		return nil
	}

	return w.runWatchers(ctx, nodeList.ResourceVersion, nsList.ResourceVersion, podList.ResourceVersion, send)
}
