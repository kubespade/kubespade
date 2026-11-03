package services

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	watchpkg "k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// WatchResources streams real-time resource state via the Kubernetes Watch API.
// On every Add/Modify/Delete event it re-lists and sends the full current list.
// A 30 s ticker acts as a fallback in case watch events are missed.
func WatchResources(ctx context.Context, k8sCfg *rest.Config, kind, namespace string, send func(any) bool) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}

	// Initial snapshot.
	if !pushResourceList(ctx, client, kind, namespace, send) {
		return nil
	}

	watcher, err := startResourceWatcher(ctx, client, kind, namespace)
	if err != nil {
		return fmt.Errorf("watch %s: %w", kind, err)
	}
	defer watcher.Stop()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil

		case <-ticker.C:
			if !pushResourceList(ctx, client, kind, namespace, send) {
				return nil
			}

		case _, ok := <-watcher.ResultChan():
			if !ok {
				return fmt.Errorf("watch channel closed")
			}
			// Drain rapid burst of events (e.g. rolling deployment) before re-listing.
			drainWatch(watcher, 150*time.Millisecond)
			if !pushResourceList(ctx, client, kind, namespace, send) {
				return nil
			}
		}
	}
}

func pushResourceList(ctx context.Context, client *kubernetes.Clientset, kind, namespace string, send func(any) bool) bool {
	list, err := listByKind(ctx, client, kind, namespace)
	if err != nil {
		return true // transient error — keep connection alive
	}
	return send(map[string]any{"type": "list", "data": list})
}

func drainWatch(w watchpkg.Interface, d time.Duration) {
	deadline := time.After(d)
	for {
		select {
		case <-deadline:
			return
		case _, ok := <-w.ResultChan():
			if !ok {
				return
			}
		}
	}
}

func startResourceWatcher(ctx context.Context, client *kubernetes.Clientset, kind, namespace string) (watchpkg.Interface, error) {
	opts := metav1.ListOptions{}
	switch kind {
	case "pods":
		return client.CoreV1().Pods(namespace).Watch(ctx, opts)
	case "deployments":
		return client.AppsV1().Deployments(namespace).Watch(ctx, opts)
	case "daemonsets":
		return client.AppsV1().DaemonSets(namespace).Watch(ctx, opts)
	case "statefulsets":
		return client.AppsV1().StatefulSets(namespace).Watch(ctx, opts)
	case "jobs":
		return client.BatchV1().Jobs(namespace).Watch(ctx, opts)
	case "cronjobs":
		return client.BatchV1().CronJobs(namespace).Watch(ctx, opts)
	case "services":
		return client.CoreV1().Services(namespace).Watch(ctx, opts)
	case "ingresses":
		return client.NetworkingV1().Ingresses(namespace).Watch(ctx, opts)
	case "persistentvolumeclaims":
		return client.CoreV1().PersistentVolumeClaims(namespace).Watch(ctx, opts)
	case "configmaps":
		return client.CoreV1().ConfigMaps(namespace).Watch(ctx, opts)
	case "secrets":
		return client.CoreV1().Secrets(namespace).Watch(ctx, opts)
	case "replicasets":
		return client.AppsV1().ReplicaSets(namespace).Watch(ctx, opts)
	case "replicationcontrollers":
		return client.CoreV1().ReplicationControllers(namespace).Watch(ctx, opts)
	case "persistentvolumes":
		return client.CoreV1().PersistentVolumes().Watch(ctx, opts)
	case "storageclasses":
		return client.StorageV1().StorageClasses().Watch(ctx, opts)
	case "endpointslices":
		return client.DiscoveryV1().EndpointSlices(namespace).Watch(ctx, opts)
	case "endpoints":
		return client.CoreV1().Endpoints(namespace).Watch(ctx, opts)
	case "ingressclasses":
		return client.NetworkingV1().IngressClasses().Watch(ctx, opts)
	case "networkpolicies":
		return client.NetworkingV1().NetworkPolicies(namespace).Watch(ctx, opts)
	case "resourcequotas":
		return client.CoreV1().ResourceQuotas(namespace).Watch(ctx, opts)
	case "limitranges":
		return client.CoreV1().LimitRanges(namespace).Watch(ctx, opts)
	case "horizontalpodautoscalers":
		return client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Watch(ctx, opts)
	case "poddisruptionbudgets":
		return client.PolicyV1().PodDisruptionBudgets(namespace).Watch(ctx, opts)
	case "priorityclasses":
		return client.SchedulingV1().PriorityClasses().Watch(ctx, opts)
	case "runtimeclasses":
		return client.NodeV1().RuntimeClasses().Watch(ctx, opts)
	case "leases":
		return client.CoordinationV1().Leases(namespace).Watch(ctx, opts)
	case "mutatingwebhookconfigurations":
		return client.AdmissionregistrationV1().MutatingWebhookConfigurations().Watch(ctx, opts)
	case "validatingwebhookconfigurations":
		return client.AdmissionregistrationV1().ValidatingWebhookConfigurations().Watch(ctx, opts)
	case "serviceaccounts":
		return client.CoreV1().ServiceAccounts(namespace).Watch(ctx, opts)
	case "clusterroles":
		return client.RbacV1().ClusterRoles().Watch(ctx, opts)
	case "roles":
		return client.RbacV1().Roles(namespace).Watch(ctx, opts)
	case "clusterrolebindings":
		return client.RbacV1().ClusterRoleBindings().Watch(ctx, opts)
	case "rolebindings":
		return client.RbacV1().RoleBindings(namespace).Watch(ctx, opts)
	case "namespaces":
		return client.CoreV1().Namespaces().Watch(ctx, opts)
	case "events":
		return client.EventsV1().Events(namespace).Watch(ctx, opts)
	case "certificatesigningrequests":
		return client.CertificatesV1().CertificateSigningRequests().Watch(ctx, opts)
	case "csidrivers":
		return client.StorageV1().CSIDrivers().Watch(ctx, opts)
	case "csinodes":
		return client.StorageV1().CSINodes().Watch(ctx, opts)
	case "volumeattachments":
		return client.StorageV1().VolumeAttachments().Watch(ctx, opts)
	case "csistoragecapacities":
		return client.StorageV1().CSIStorageCapacities(namespace).Watch(ctx, opts)
	case "flowschemas":
		return client.FlowcontrolV1().FlowSchemas().Watch(ctx, opts)
	case "prioritylevelconfigurations":
		return client.FlowcontrolV1().PriorityLevelConfigurations().Watch(ctx, opts)
	case "validatingadmissionpolicies":
		return client.AdmissionregistrationV1().ValidatingAdmissionPolicies().Watch(ctx, opts)
	case "validatingadmissionpolicybindings":
		return client.AdmissionregistrationV1().ValidatingAdmissionPolicyBindings().Watch(ctx, opts)
	default:
		return nil, fmt.Errorf("unknown resource kind: %s", kind)
	}
}
