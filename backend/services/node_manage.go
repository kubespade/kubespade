package services

import (
	"context"
	"fmt"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
)

func CordonNode(ctx context.Context, k8sCfg *rest.Config, nodeName string) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	patch := []byte(`{"spec":{"unschedulable":true}}`)
	_, err = client.CoreV1().Nodes().Patch(ctx, nodeName, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

func UncordonNode(ctx context.Context, k8sCfg *rest.Config, nodeName string) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	patch := []byte(`{"spec":{"unschedulable":null}}`)
	_, err = client.CoreV1().Nodes().Patch(ctx, nodeName, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

func DrainNode(ctx context.Context, k8sCfg *rest.Config, nodeName string, log func(string)) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}

	// 1. Cordon
	log(fmt.Sprintf("Cordoning node %s…", nodeName))
	patch := []byte(`{"spec":{"unschedulable":true}}`)
	if _, err := client.CoreV1().Nodes().Patch(ctx, nodeName, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("cordon failed: %w", err)
	}
	log("Node cordoned.")

	// 2. List pods on node
	podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("spec.nodeName=%s", nodeName),
	})
	if err != nil {
		return fmt.Errorf("list pods: %w", err)
	}

	// 3. Filter: skip daemonset pods and mirror pods
	var toEvict []corev1.Pod
	for _, pod := range podList.Items {
		if isDaemonSetPod(pod) {
			log(fmt.Sprintf("  Skipping DaemonSet pod %s/%s", pod.Namespace, pod.Name))
			continue
		}
		if isMirrorPod(pod) {
			log(fmt.Sprintf("  Skipping mirror pod %s/%s", pod.Namespace, pod.Name))
			continue
		}
		toEvict = append(toEvict, pod)
	}

	if len(toEvict) == 0 {
		log("No pods to evict.")
		log("Drain complete.")
		return nil
	}
	log(fmt.Sprintf("Evicting %d pod(s)…", len(toEvict)))

	// 4. Evict each pod
	for _, pod := range toEvict {
		select {
		case <-ctx.Done():
			log("Drain cancelled.")
			return nil
		default:
		}

		log(fmt.Sprintf("  Evicting %s/%s…", pod.Namespace, pod.Name))
		eviction := &policyv1.Eviction{
			ObjectMeta: metav1.ObjectMeta{
				Name:      pod.Name,
				Namespace: pod.Namespace,
			},
		}
		if err := client.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction); err != nil {
			if k8serrors.IsTooManyRequests(err) {
				log("    PodDisruptionBudget blocks eviction, retrying in 5s…")
				select {
				case <-ctx.Done():
					return nil
				case <-time.After(5 * time.Second):
				}
				if err := client.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction); err != nil {
					log(fmt.Sprintf("    Still blocked: %v", err))
				} else {
					log(fmt.Sprintf("    Evicted %s/%s", pod.Namespace, pod.Name))
				}
			} else {
				log(fmt.Sprintf("    Warning: %v", err))
			}
		} else {
			log(fmt.Sprintf("    Evicted %s/%s", pod.Namespace, pod.Name))
		}
	}

	// 5. Wait for termination (up to 2 min)
	log("Waiting for pods to terminate (up to 120s)…")
	deadline := time.Now().Add(2 * time.Minute)
	var lastPending []string
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			log("Drain cancelled.")
			return nil
		default:
		}
		remaining, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("spec.nodeName=%s", nodeName),
		})
		if err != nil {
			break
		}
		pendingNames := make([]string, 0)
		for _, p := range remaining.Items {
			if !isDaemonSetPod(p) && !isMirrorPod(p) {
				pendingNames = append(pendingNames, fmt.Sprintf("%s/%s", p.Namespace, p.Name))
			}
		}
		lastPending = pendingNames
		if len(pendingNames) == 0 {
			log("All pods terminated.")
			lastPending = nil
			break
		}
		log(fmt.Sprintf("  %d pod(s) still terminating:", len(pendingNames)))
		for _, id := range pendingNames {
			log(fmt.Sprintf("    %s", id))
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(3 * time.Second):
		}
	}
	if len(lastPending) > 0 {
		log("Timeout reached — pods still terminating:")
		for _, id := range lastPending {
			log(fmt.Sprintf("  %s", id))
		}
	}

	log("Drain complete.")
	return nil
}

// IsEvictablePod reports whether a pod would be evicted during node drain.
func IsEvictablePod(pod corev1.Pod) bool {
	return !isDaemonSetPod(pod) && !isMirrorPod(pod)
}

// WorkloadPodsByNode counts evictable pods per node (same rules as drain).
func WorkloadPodsByNode(pods []corev1.Pod) map[string]int {
	counts := make(map[string]int)
	for _, pod := range pods {
		node := pod.Spec.NodeName
		if node == "" || !IsEvictablePod(pod) {
			continue
		}
		counts[node]++
	}
	return counts
}

type NodePodInfo struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Phase     string `json:"phase"`
	OwnerKind string `json:"ownerKind,omitempty"`
}

func ListNodePods(ctx context.Context, k8sCfg *rest.Config, nodeName string) ([]NodePodInfo, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("spec.nodeName=%s", nodeName),
	})
	if err != nil {
		return nil, err
	}
	out := make([]NodePodInfo, 0, len(podList.Items))
	for _, pod := range podList.Items {
		ownerKind := ""
		if len(pod.OwnerReferences) > 0 {
			ownerKind = pod.OwnerReferences[0].Kind
		}
		out = append(out, NodePodInfo{
			Namespace: pod.Namespace,
			Name:      pod.Name,
			Phase:     string(pod.Status.Phase),
			OwnerKind: ownerKind,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func isDaemonSetPod(pod corev1.Pod) bool {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind == "DaemonSet" {
			return true
		}
	}
	return false
}

func isMirrorPod(pod corev1.Pod) bool {
	_, ok := pod.Annotations["kubernetes.io/config.mirror"]
	return ok
}
