package services

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestResourceNamespaceForKind(t *testing.T) {
	t.Run("cluster-scoped kind → empty", func(t *testing.T) {
		obj := &unstructured.Unstructured{Object: map[string]interface{}{}}
		obj.SetNamespace("ignored")
		if got := resourceNamespaceForKind("namespaces", "default", obj); got != "" {
			t.Errorf("got %q, want empty for cluster-scoped", got)
		}
	})
	t.Run("namespaced kind uses object namespace", func(t *testing.T) {
		obj := &unstructured.Unstructured{Object: map[string]interface{}{}}
		obj.SetNamespace("team-a")
		if got := resourceNamespaceForKind("pods", "default", obj); got != "team-a" {
			t.Errorf("got %q, want team-a", got)
		}
	})
	t.Run("namespaced kind falls back to default", func(t *testing.T) {
		obj := &unstructured.Unstructured{Object: map[string]interface{}{}}
		if got := resourceNamespaceForKind("pods", "fallback-ns", obj); got != "fallback-ns" {
			t.Errorf("got %q, want fallback-ns", got)
		}
	})
}

func TestYAMLToUnstructured(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		obj, err := yamlToUnstructured("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\n  namespace: ns\ndata:\n  key: value\n")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if obj.GetKind() != "ConfigMap" || obj.GetName() != "cm" || obj.GetNamespace() != "ns" {
			t.Errorf("unexpected object: kind=%q name=%q ns=%q", obj.GetKind(), obj.GetName(), obj.GetNamespace())
		}
	})
	t.Run("invalid yaml", func(t *testing.T) {
		if _, err := yamlToUnstructured("\t: : :bad"); err == nil {
			t.Error("expected error for invalid yaml")
		}
	})
}

func TestObjectToYAML_stripsManagedFields(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]interface{}{
			"name":          "cm",
			"managedFields": []interface{}{map[string]interface{}{"manager": "kubectl"}},
		},
	}}
	out, err := objectToYAML(obj)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if strings.Contains(out, "managedFields") {
		t.Errorf("managedFields should be stripped, got:\n%s", out)
	}
	if !strings.Contains(out, "name: cm") {
		t.Errorf("expected name preserved, got:\n%s", out)
	}
}

func TestPrepareForWrite(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata":   map[string]interface{}{"name": "cm"},
		"status":     map[string]interface{}{"phase": "x"},
	}}
	obj.SetResourceVersion("123")
	obj.SetUID("uid-1")
	obj.SetGeneration(4)

	prepareForWrite(obj)

	if obj.GetResourceVersion() != "" {
		t.Errorf("resourceVersion not cleared: %q", obj.GetResourceVersion())
	}
	if obj.GetUID() != "" {
		t.Errorf("uid not cleared: %q", obj.GetUID())
	}
	if obj.GetGeneration() != 0 {
		t.Errorf("generation not cleared: %d", obj.GetGeneration())
	}
	if _, found, _ := unstructured.NestedMap(obj.Object, "status"); found {
		t.Error("status not removed")
	}
}

func TestPrepareForWriteKeepRV(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata":   map[string]interface{}{"name": "cm"},
		"status":     map[string]interface{}{"phase": "x"},
	}}
	obj.SetResourceVersion("999")
	obj.SetUID("uid-1")

	prepareForWriteKeepRV(obj)

	if obj.GetResourceVersion() != "999" {
		t.Errorf("resourceVersion should be kept, got %q", obj.GetResourceVersion())
	}
	if obj.GetUID() != "" {
		t.Errorf("uid not cleared: %q", obj.GetUID())
	}
	if _, found, _ := unstructured.NestedMap(obj.Object, "status"); found {
		t.Error("status not removed")
	}
}

func TestSplitYAMLDocuments(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		docs, err := splitYAMLDocuments("   \n  ")
		if err != nil || docs != nil {
			t.Errorf("got docs=%v err=%v, want nil,nil", docs, err)
		}
	})
	t.Run("single doc", func(t *testing.T) {
		docs, err := splitYAMLDocuments("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if len(docs) != 1 {
			t.Fatalf("got %d docs, want 1", len(docs))
		}
	})
	t.Run("multi doc with empty separator skipped", func(t *testing.T) {
		multi := "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n---\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: b\n"
		docs, err := splitYAMLDocuments(multi)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if len(docs) != 2 {
			t.Fatalf("got %d docs, want 2", len(docs))
		}
	})
	t.Run("invalid yaml errors", func(t *testing.T) {
		if _, err := splitYAMLDocuments("key: value\n\tbad: ["); err == nil {
			t.Error("expected error for invalid yaml")
		}
	})
}
