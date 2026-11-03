package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	sigsyaml "sigs.k8s.io/yaml"
)

// ResourceKind describes one supported Kubernetes resource. resourceRegistry is
// the single source of truth; the kindToGVR / kindNameToResource /
// clusterScopedKinds / kindSingular lookup maps below are all derived from it in
// init(), so adding or renaming a kind means editing exactly one place.
type ResourceKind struct {
	Plural        string // API resource plural (our canonical key)
	Kind          string // PascalCase singular Kind
	GVR           schema.GroupVersionResource
	ClusterScoped bool
}

var resourceRegistry = []ResourceKind{
	{"pods", "Pod", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}, false},
	{"replicationcontrollers", "ReplicationController", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "replicationcontrollers"}, false},
	{"services", "Service", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"}, false},
	{"endpoints", "Endpoints", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "endpoints"}, false},
	{"persistentvolumeclaims", "PersistentVolumeClaim", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumeclaims"}, false},
	{"persistentvolumes", "PersistentVolume", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumes"}, true},
	{"configmaps", "ConfigMap", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}, false},
	{"secrets", "Secret", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}, false},
	{"resourcequotas", "ResourceQuota", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "resourcequotas"}, false},
	{"limitranges", "LimitRange", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "limitranges"}, false},
	{"serviceaccounts", "ServiceAccount", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "serviceaccounts"}, false},
	{"namespaces", "Namespace", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "namespaces"}, true},
	{"nodes", "Node", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}, true},
	{"deployments", "Deployment", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, false},
	{"replicasets", "ReplicaSet", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "replicasets"}, false},
	{"daemonsets", "DaemonSet", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}, false},
	{"statefulsets", "StatefulSet", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}, false},
	{"jobs", "Job", schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "jobs"}, false},
	{"cronjobs", "CronJob", schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "cronjobs"}, false},
	{"ingresses", "Ingress", schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}, false},
	{"ingressclasses", "IngressClass", schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingressclasses"}, true},
	{"networkpolicies", "NetworkPolicy", schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"}, false},
	{"endpointslices", "EndpointSlice", schema.GroupVersionResource{Group: "discovery.k8s.io", Version: "v1", Resource: "endpointslices"}, false},
	{"storageclasses", "StorageClass", schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"}, true},
	{"horizontalpodautoscalers", "HorizontalPodAutoscaler", schema.GroupVersionResource{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"}, false},
	{"poddisruptionbudgets", "PodDisruptionBudget", schema.GroupVersionResource{Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"}, false},
	{"priorityclasses", "PriorityClass", schema.GroupVersionResource{Group: "scheduling.k8s.io", Version: "v1", Resource: "priorityclasses"}, true},
	{"runtimeclasses", "RuntimeClass", schema.GroupVersionResource{Group: "node.k8s.io", Version: "v1", Resource: "runtimeclasses"}, true},
	{"leases", "Lease", schema.GroupVersionResource{Group: "coordination.k8s.io", Version: "v1", Resource: "leases"}, false},
	{"mutatingwebhookconfigurations", "MutatingWebhookConfiguration", schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"}, true},
	{"validatingwebhookconfigurations", "ValidatingWebhookConfiguration", schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"}, true},
	{"clusterroles", "ClusterRole", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}, true},
	{"roles", "Role", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}, false},
	{"clusterrolebindings", "ClusterRoleBinding", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"}, true},
	{"rolebindings", "RoleBinding", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"}, false},
	{"events", "Event", schema.GroupVersionResource{Group: "events.k8s.io", Version: "v1", Resource: "events"}, false},
	{"certificatesigningrequests", "CertificateSigningRequest", schema.GroupVersionResource{Group: "certificates.k8s.io", Version: "v1", Resource: "certificatesigningrequests"}, true},
	{"csidrivers", "CSIDriver", schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "csidrivers"}, true},
	{"csinodes", "CSINode", schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "csinodes"}, true},
	{"csistoragecapacities", "CSIStorageCapacity", schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "csistoragecapacities"}, false},
	{"volumeattachments", "VolumeAttachment", schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "volumeattachments"}, true},
	{"flowschemas", "FlowSchema", schema.GroupVersionResource{Group: "flowcontrol.apiserver.k8s.io", Version: "v1", Resource: "flowschemas"}, true},
	{"prioritylevelconfigurations", "PriorityLevelConfiguration", schema.GroupVersionResource{Group: "flowcontrol.apiserver.k8s.io", Version: "v1", Resource: "prioritylevelconfigurations"}, true},
	{"validatingadmissionpolicies", "ValidatingAdmissionPolicy", schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingadmissionpolicies"}, true},
	{"validatingadmissionpolicybindings", "ValidatingAdmissionPolicyBinding", schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingadmissionpolicybindings"}, true},
}

// Lookup maps derived from resourceRegistry. Do not edit directly — add entries
// to resourceRegistry instead.
var (
	kindToGVR          = map[string]schema.GroupVersionResource{}
	clusterScopedKinds = map[string]bool{}
	// kindNameToResource maps Kubernetes Kind (PascalCase) → API resource plural.
	kindNameToResource = map[string]string{}
	// kindSingular maps plural resource name → singular Kind (for event field selectors).
	kindSingular = map[string]string{}
)

func init() {
	for _, rk := range resourceRegistry {
		kindToGVR[rk.Plural] = rk.GVR
		kindNameToResource[rk.Kind] = rk.Plural
		kindSingular[rk.Plural] = rk.Kind
		if rk.ClusterScoped {
			clusterScopedKinds[rk.Plural] = true
		}
	}
	// Preserve prior behaviour: events were never resolved to a singular Kind for
	// the involvedObject.kind selector (an Event never references another Event).
	delete(kindSingular, "events")
}

// ApplyResult is one document from a multi-doc apply.
type ApplyResult struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Action    string `json:"action"` // "created" | "configured"
}

func dynClientFor(k8sCfg *rest.Config) (dynamic.Interface, error) {
	return dynamic.NewForConfig(k8sCfg)
}

// clientset builds a typed Kubernetes clientset from a rest.Config. Companion to
// dynClientFor for the many service functions that need the typed API.
func clientset(k8sCfg *rest.Config) (*kubernetes.Clientset, error) {
	return kubernetes.NewForConfig(k8sCfg)
}

func resourceInterface(client dynamic.Interface, gvr schema.GroupVersionResource, namespace string) dynamic.ResourceInterface {
	if namespace != "" {
		return client.Resource(gvr).Namespace(namespace)
	}
	return client.Resource(gvr)
}

// GetResourceYAML returns the YAML representation of a standard K8s resource.
func GetResourceYAML(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name string) (string, error) {
	gvr, ok := kindToGVR[kind]
	if !ok {
		return "", fmt.Errorf("unknown resource kind: %q", kind)
	}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return "", err
	}
	obj, err := resourceInterface(client, gvr, namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	return objectToYAML(obj)
}

// ApplyResourceYAML creates or updates a standard K8s resource from YAML (kubectl apply semantics).
func ApplyResourceYAML(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name, yamlText string) error {
	gvr, ok := kindToGVR[kind]
	if !ok {
		return fmt.Errorf("unknown resource kind: %q", kind)
	}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return err
	}
	obj, err := yamlToUnstructured(yamlText)
	if err != nil {
		return err
	}
	if obj.GetName() != name {
		return fmt.Errorf("resource name in YAML (%q) does not match requested name (%q)", obj.GetName(), name)
	}
	ns := resourceNamespaceForKind(kind, namespace, obj)
	ri := resourceInterface(client, gvr, ns)
	current, err := ri.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			prepareForWrite(obj)
			_, err = ri.Create(ctx, obj, metav1.CreateOptions{})
			return err
		}
		return err
	}
	obj.SetResourceVersion(current.GetResourceVersion())
	_, err = ri.Update(ctx, obj, metav1.UpdateOptions{})
	return err
}

// CreateResourceYAML creates a new standard K8s resource from YAML.
func CreateResourceYAML(ctx context.Context, k8sCfg *rest.Config, kind, defaultNamespace, yamlText string) (string, error) {
	gvr, ok := kindToGVR[kind]
	if !ok {
		return "", fmt.Errorf("unknown resource kind: %q", kind)
	}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return "", err
	}
	obj, err := yamlToUnstructured(yamlText)
	if err != nil {
		return "", err
	}
	name := obj.GetName()
	if name == "" {
		return "", fmt.Errorf("metadata.name is required")
	}
	ns := resourceNamespaceForKind(kind, defaultNamespace, obj)
	if !clusterScopedKinds[kind] && defaultNamespace != "" && obj.GetNamespace() == "" {
		obj.SetNamespace(defaultNamespace)
		ns = defaultNamespace
	}
	ri := resourceInterface(client, gvr, ns)
	prepareForWrite(obj)
	_, err = ri.Create(ctx, obj, metav1.CreateOptions{})
	if err != nil {
		return "", err
	}
	return name, nil
}

// ApplyManifestYAML applies multi-document YAML (kubectl apply -f semantics: create or update each doc).
func ApplyManifestYAML(ctx context.Context, k8sCfg *rest.Config, yamlText string) ([]ApplyResult, error) {
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return nil, err
	}
	docs, err := splitYAMLDocuments(yamlText)
	if err != nil {
		return nil, err
	}
	if len(docs) == 0 {
		return nil, fmt.Errorf("no resources found in YAML")
	}

	results := make([]ApplyResult, 0, len(docs))
	for i, doc := range docs {
		obj, err := yamlToUnstructured(doc)
		if err != nil {
			return results, fmt.Errorf("document %d: %w", i+1, err)
		}
		kindName := obj.GetKind()
		if kindName == "" {
			return results, fmt.Errorf("document %d: kind is required", i+1)
		}
		name := obj.GetName()
		if name == "" {
			return results, fmt.Errorf("document %d (%s): metadata.name is required", i+1, kindName)
		}
		resource, ok := kindNameToResource[kindName]
		if !ok {
			return results, fmt.Errorf("document %d: unsupported kind %q", i+1, kindName)
		}
		gvr, ok := kindToGVR[resource]
		if !ok {
			return results, fmt.Errorf("document %d: unknown resource %q", i+1, resource)
		}
		ns := resourceNamespaceForKind(resource, obj.GetNamespace(), obj)
		if !clusterScopedKinds[resource] && ns == "" {
			return results, fmt.Errorf("document %d (%s/%s): namespace is required", i+1, kindName, name)
		}
		if !clusterScopedKinds[resource] && obj.GetNamespace() == "" {
			obj.SetNamespace(ns)
		}

		ri := resourceInterface(client, gvr, ns)
		current, err := ri.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			if k8serrors.IsNotFound(err) {
				prepareForWrite(obj)
				if _, err = ri.Create(ctx, obj, metav1.CreateOptions{}); err != nil {
					return results, fmt.Errorf("%s/%s: create failed: %w", kindName, name, err)
				}
				results = append(results, ApplyResult{Kind: kindName, Name: name, Namespace: ns, Action: "created"})
				continue
			}
			return results, fmt.Errorf("%s/%s: %w", kindName, name, err)
		}
		obj.SetResourceVersion(current.GetResourceVersion())
		prepareForWriteKeepRV(obj)
		if _, err = ri.Update(ctx, obj, metav1.UpdateOptions{}); err != nil {
			return results, fmt.Errorf("%s/%s: update failed: %w", kindName, name, err)
		}
		results = append(results, ApplyResult{Kind: kindName, Name: name, Namespace: ns, Action: "configured"})
	}
	return results, nil
}

// DeleteResourceOptions controls kubectl-style delete flags.
type DeleteResourceOptions struct {
	Force              bool
	GracePeriodSeconds *int64
	// Propagation: "Foreground" (default), "Background", or "Orphan".
	Propagation string
}

// ParseDeleteResourceOptions reads force / gracePeriod / propagation query values.
func ParseDeleteResourceOptions(force, gracePeriod, propagation string) (DeleteResourceOptions, error) {
	opts := DeleteResourceOptions{
		Force:       force == "true" || force == "1",
		Propagation: strings.TrimSpace(propagation),
	}
	if opts.Propagation == "" {
		opts.Propagation = string(metav1.DeletePropagationForeground)
	}
	switch metav1.DeletionPropagation(opts.Propagation) {
	case metav1.DeletePropagationForeground, metav1.DeletePropagationBackground, metav1.DeletePropagationOrphan:
		// ok
	default:
		return DeleteResourceOptions{}, fmt.Errorf("invalid propagation %q (use Foreground, Background, or Orphan)", opts.Propagation)
	}
	gracePeriod = strings.TrimSpace(gracePeriod)
	if gracePeriod != "" {
		n, err := strconv.ParseInt(gracePeriod, 10, 64)
		if err != nil || n < 0 {
			return DeleteResourceOptions{}, fmt.Errorf("invalid gracePeriod %q", gracePeriod)
		}
		opts.GracePeriodSeconds = &n
	}
	if opts.Force && opts.GracePeriodSeconds == nil {
		zero := int64(0)
		opts.GracePeriodSeconds = &zero
	}
	return opts, nil
}

func deleteOptionsFrom(opts DeleteResourceOptions) metav1.DeleteOptions {
	policy := metav1.DeletionPropagation(opts.Propagation)
	if policy == "" {
		policy = metav1.DeletePropagationForeground
	}
	out := metav1.DeleteOptions{PropagationPolicy: &policy}
	if opts.GracePeriodSeconds != nil {
		out.GracePeriodSeconds = opts.GracePeriodSeconds
	} else if opts.Force {
		zero := int64(0)
		out.GracePeriodSeconds = &zero
	}
	return out
}

// DeleteResource deletes a standard K8s resource.
// Force with no explicit grace period uses gracePeriodSeconds=0
// (kubectl delete --force --grace-period=0).
func DeleteResource(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name string, opts DeleteResourceOptions) error {
	gvr, ok := kindToGVR[kind]
	if !ok {
		return fmt.Errorf("unknown resource kind: %q", kind)
	}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return err
	}
	return resourceInterface(client, gvr, namespace).Delete(ctx, name, deleteOptionsFrom(opts))
}

// GetCRDResourceYAML returns the YAML of a CRD instance.
func GetCRDResourceYAML(ctx context.Context, k8sCfg *rest.Config, group, version, plural, namespace, name string) (string, error) {
	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: plural}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return "", err
	}
	obj, err := resourceInterface(client, gvr, namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	return objectToYAML(obj)
}

// ApplyCRDResourceYAML updates a CRD instance from YAML.
func ApplyCRDResourceYAML(ctx context.Context, k8sCfg *rest.Config, group, version, plural, namespace, name, yamlText string) error {
	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: plural}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return err
	}
	obj, err := yamlToUnstructured(yamlText)
	if err != nil {
		return err
	}
	if obj.GetName() != name {
		return fmt.Errorf("resource name in YAML (%q) does not match requested name (%q)", obj.GetName(), name)
	}
	ri := resourceInterface(client, gvr, namespace)
	// Refresh resourceVersion to avoid optimistic concurrency conflicts.
	current, err := ri.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	obj.SetResourceVersion(current.GetResourceVersion())
	_, err = ri.Update(ctx, obj, metav1.UpdateOptions{})
	return err
}

// DeleteCRDResource deletes a CRD instance.
func DeleteCRDResource(ctx context.Context, k8sCfg *rest.Config, group, version, plural, namespace, name string, opts DeleteResourceOptions) error {
	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: plural}
	client, err := dynClientFor(k8sCfg)
	if err != nil {
		return err
	}
	return resourceInterface(client, gvr, namespace).Delete(ctx, name, deleteOptionsFrom(opts))
}

func objectToYAML(obj *unstructured.Unstructured) (string, error) {
	// Remove noisy managed fields
	meta, _, _ := unstructured.NestedMap(obj.Object, "metadata")
	if meta != nil {
		delete(meta, "managedFields")
		_ = unstructured.SetNestedMap(obj.Object, meta, "metadata")
	}

	jsonBytes, err := json.Marshal(obj.Object)
	if err != nil {
		return "", err
	}
	yamlBytes, err := sigsyaml.JSONToYAML(jsonBytes)
	if err != nil {
		return "", err
	}
	return string(yamlBytes), nil
}

func yamlToUnstructured(yamlText string) (*unstructured.Unstructured, error) {
	jsonBytes, err := sigsyaml.YAMLToJSON([]byte(yamlText))
	if err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	obj := &unstructured.Unstructured{}
	if err := obj.UnmarshalJSON(jsonBytes); err != nil {
		return nil, fmt.Errorf("invalid resource object: %w", err)
	}
	return obj, nil
}

func resourceNamespaceForKind(kind, defaultNamespace string, obj *unstructured.Unstructured) string {
	if clusterScopedKinds[kind] {
		return ""
	}
	if ns := obj.GetNamespace(); ns != "" {
		return ns
	}
	return defaultNamespace
}

func prepareForWrite(obj *unstructured.Unstructured) {
	unstructured.RemoveNestedField(obj.Object, "status")
	obj.SetResourceVersion("")
	obj.SetUID("")
	obj.SetGeneration(0)
	obj.SetSelfLink("")
	obj.SetManagedFields(nil)
}

// prepareForWriteKeepRV clears server-managed fields but keeps resourceVersion for updates.
func prepareForWriteKeepRV(obj *unstructured.Unstructured) {
	rv := obj.GetResourceVersion()
	unstructured.RemoveNestedField(obj.Object, "status")
	obj.SetUID("")
	obj.SetGeneration(0)
	obj.SetSelfLink("")
	obj.SetManagedFields(nil)
	obj.SetResourceVersion(rv)
}

func splitYAMLDocuments(yamlText string) ([]string, error) {
	trimmed := strings.TrimSpace(yamlText)
	if trimmed == "" {
		return nil, nil
	}
	dec := utilyaml.NewYAMLOrJSONDecoder(bytes.NewReader([]byte(trimmed)), 4096)
	var docs []string
	for {
		var raw map[string]interface{}
		err := dec.Decode(&raw)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid YAML: %w", err)
		}
		if len(raw) == 0 {
			continue
		}
		b, err := sigsyaml.Marshal(raw)
		if err != nil {
			return nil, fmt.Errorf("failed to re-encode YAML document: %w", err)
		}
		docs = append(docs, string(b))
	}
	return docs, nil
}
