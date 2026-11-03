package services

import (
	"context"
	"fmt"
	"sort"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
)

func stripManagedFields(obj *unstructured.Unstructured) {
	meta, _, _ := unstructured.NestedMap(obj.Object, "metadata")
	if meta != nil {
		delete(meta, "managedFields")
		_ = unstructured.SetNestedMap(obj.Object, meta, "metadata")
	}
}

// GetResourceDetail returns a standard K8s resource as a JSON-serialisable map.
func GetResourceDetail(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name string) (map[string]interface{}, error) {
	gvr, ok := kindToGVR[kind]
	if !ok {
		return nil, fmt.Errorf("unknown resource kind: %q", kind)
	}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return nil, err
	}
	obj, err := resourceInterface(client, gvr, namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	stripManagedFields(obj)
	return obj.Object, nil
}

// GetCRDResourceDetail returns a CRD instance as a JSON-serialisable map.
func GetCRDResourceDetail(ctx context.Context, k8sCfg *rest.Config, group, version, plural, namespace, name string) (map[string]interface{}, error) {
	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: plural}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return nil, err
	}
	obj, err := resourceInterface(client, gvr, namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	stripManagedFields(obj)
	return obj.Object, nil
}

// ResourceEvent is a minimal event record returned to the frontend.
type ResourceEvent struct {
	Type    string `json:"type"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
	Count   int32  `json:"count"`
	Age     int64  `json:"age"`
}

// listEventsBySelector lists CoreV1 events matching a field selector, mapped to
// ResourceEvent and sorted newest first. namespace == "" lists across all namespaces.
func listEventsBySelector(ctx context.Context, k8sCfg *rest.Config, namespace, fieldSelector string) ([]ResourceEvent, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}

	list, err := client.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{FieldSelector: fieldSelector})
	if err != nil {
		return nil, err
	}

	events := make([]ResourceEvent, 0, len(list.Items))
	for _, e := range list.Items {
		count := e.Count
		if count == 0 {
			count = 1
		}
		age := e.LastTimestamp.Unix()
		if age <= 0 {
			age = e.CreationTimestamp.Unix()
		}
		events = append(events, ResourceEvent{
			Type:    e.Type,
			Reason:  e.Reason,
			Message: e.Message,
			Count:   count,
			Age:     age,
		})
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].Age > events[j].Age
	})

	return events, nil
}

// eventFieldSelector builds an involvedObject field selector, adding the kind
// clause only when a Kind is known.
func eventFieldSelector(name, kind string) string {
	fieldSelector := "involvedObject.name=" + name
	if kind != "" {
		fieldSelector += ",involvedObject.kind=" + kind
	}
	return fieldSelector
}

// ListResourceEvents returns CoreV1 events related to a given resource, newest first.
func ListResourceEvents(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name string) ([]ResourceEvent, error) {
	return listEventsBySelector(ctx, k8sCfg, namespace, eventFieldSelector(name, kindSingular[kind]))
}

// ListCRDResourceEvents returns events for a CRD instance (matched by name + Kind).
func ListCRDResourceEvents(ctx context.Context, k8sCfg *rest.Config, crdKind, namespace, name string) ([]ResourceEvent, error) {
	return listEventsBySelector(ctx, k8sCfg, namespace, eventFieldSelector(name, crdKind))
}
