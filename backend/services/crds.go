package services

import (
	"context"
	"fmt"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

type CRDVersion struct {
	Name    string `json:"name"`
	Served  bool   `json:"served"`
	Storage bool   `json:"storage"`
}

type CRDInfo struct {
	Name     string       `json:"name"`   // full CRD name e.g. "certificates.cert-manager.io"
	Group    string       `json:"group"`  // e.g. "cert-manager.io"
	Kind     string       `json:"kind"`   // e.g. "Certificate"
	Plural   string       `json:"plural"` // e.g. "certificates"
	Scope    string       `json:"scope"`  // "Namespaced" or "Cluster"
	Versions []CRDVersion `json:"versions"`
}

type CRDGroup struct {
	Group string    `json:"group"`
	CRDs  []CRDInfo `json:"crds"`
}

var crdGVR = schema.GroupVersionResource{
	Group:    "apiextensions.k8s.io",
	Version:  "v1",
	Resource: "customresourcedefinitions",
}

func ListCRDGroups(ctx context.Context, k8sCfg *rest.Config) ([]CRDGroup, error) {
	dynClient, err := dynamic.NewForConfig(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create dynamic client: %w", err)
	}

	list, err := dynClient.Resource(crdGVR).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list CRDs: %w", err)
	}

	byGroup := make(map[string][]CRDInfo)
	for _, item := range list.Items {
		info := parseCRDObject(item.Object)
		info.Name = item.GetName()
		byGroup[info.Group] = append(byGroup[info.Group], info)
	}

	groups := make([]CRDGroup, 0, len(byGroup))
	for group, crds := range byGroup {
		sort.Slice(crds, func(i, j int) bool { return crds[i].Kind < crds[j].Kind })
		groups = append(groups, CRDGroup{Group: group, CRDs: crds})
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Group < groups[j].Group })

	return groups, nil
}

func parseCRDObject(obj map[string]interface{}) CRDInfo {
	spec, _ := obj["spec"].(map[string]interface{})
	group, _ := spec["group"].(string)
	scope, _ := spec["scope"].(string)

	names, _ := spec["names"].(map[string]interface{})
	kind, _ := names["kind"].(string)
	plural, _ := names["plural"].(string)

	var versions []CRDVersion
	if vs, ok := spec["versions"].([]interface{}); ok {
		for _, v := range vs {
			vm, ok := v.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := vm["name"].(string)
			served, _ := vm["served"].(bool)
			storage, _ := vm["storage"].(bool)
			versions = append(versions, CRDVersion{Name: name, Served: served, Storage: storage})
		}
	}

	return CRDInfo{Group: group, Kind: kind, Plural: plural, Scope: scope, Versions: versions}
}

// WatchCRDInstances streams real-time instances of a custom resource via the dynamic client.
func WatchCRDInstances(ctx context.Context, k8sCfg *rest.Config, group, version, plural, namespace string, send func(any) bool) error {
	dynClient, err := dynamic.NewForConfig(k8sCfg)
	if err != nil {
		return err
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: plural}
	// Printer columns are stable for a CRD version — load once per watch session.
	printerCols, _ := loadCRDPrinterColumns(ctx, dynClient, group, version, plural)

	push := func() bool {
		list, err := listDynamic(ctx, dynClient, gvr, namespace, printerCols)
		if err != nil {
			return true // transient — keep alive
		}
		return send(map[string]any{"type": "list", "data": list})
	}

	if !push() {
		return nil
	}

	var ri dynamic.ResourceInterface
	if namespace != "" {
		ri = dynClient.Resource(gvr).Namespace(namespace)
	} else {
		ri = dynClient.Resource(gvr)
	}

	w, err := ri.Watch(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("watch CRD %s: %w", plural, err)
	}
	defer w.Stop()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if !push() {
				return nil
			}
		case _, ok := <-w.ResultChan():
			if !ok {
				return fmt.Errorf("watch channel closed")
			}
			drainWatch(w, 150*time.Millisecond)
			if !push() {
				return nil
			}
		}
	}
}

func listDynamic(
	ctx context.Context,
	dynClient dynamic.Interface,
	gvr schema.GroupVersionResource,
	namespace string,
	printerCols []crdPrinterColumn,
) (*ResourceList, error) {
	var ri dynamic.ResourceInterface
	if namespace != "" {
		ri = dynClient.Resource(gvr).Namespace(namespace)
	} else {
		ri = dynClient.Resource(gvr)
	}

	list, err := ri.List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	items := make([]ResourceRow, 0, len(list.Items))
	for _, item := range list.Items {
		var fields map[string]string
		if len(printerCols) > 0 {
			fields = evaluatePrinterColumns(item.Object, printerCols)
		} else {
			fields = extractCRDStatusFields(item.Object)
		}
		items = append(items, ResourceRow{
			Name:      item.GetName(),
			Namespace: item.GetNamespace(),
			Age:       item.GetCreationTimestamp().Unix(),
			Fields:    fields,
		})
	}

	out := &ResourceList{Kind: gvr.Resource, Items: items}
	if len(printerCols) > 0 {
		out.Columns = resourceColumnsFromPrinter(printerCols)
	} else if len(items) > 0 {
		// Heuristic fallback: expose discovered status keys as columns.
		seen := map[string]struct{}{}
		for _, it := range items {
			for k := range it.Fields {
				if _, ok := seen[k]; ok {
					continue
				}
				seen[k] = struct{}{}
				out.Columns = append(out.Columns, ResourceColumn{Key: k, Label: k})
			}
		}
	}
	return out, nil
}

// extractCRDStatusFields tries to pull a human-readable status from common CRD patterns.
func extractCRDStatusFields(obj map[string]interface{}) map[string]string {
	fields := map[string]string{}

	status, ok := obj["status"].(map[string]interface{})
	if !ok {
		return fields
	}

	// pattern 1: status.phase (e.g. cert-manager Certificate: "Ready", "Pending")
	if phase, ok := status["phase"].(string); ok && phase != "" {
		fields["status"] = phase
		return fields
	}

	// pattern 2: status.conditions — show the last condition's type+status
	if conditions, ok := status["conditions"].([]interface{}); ok && len(conditions) > 0 {
		last := conditions[len(conditions)-1]
		if cm, ok := last.(map[string]interface{}); ok {
			t, _ := cm["type"].(string)
			s, _ := cm["status"].(string)
			if t != "" {
				if s == "True" {
					fields["status"] = t
				} else {
					fields["status"] = t + "=False"
				}
			}
		}
		return fields
	}

	// pattern 3: status.ready (bool)
	if ready, ok := status["ready"].(bool); ok {
		if ready {
			fields["status"] = "Ready"
		} else {
			fields["status"] = "NotReady"
		}
	}

	return fields
}
