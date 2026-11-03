package services

import (
	"context"
	"fmt"
	"sort"
	"strconv"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const (
	revisionAnnotation    = "deployment.kubernetes.io/revision"
	changeCauseAnnotation = "kubernetes.io/change-cause"
)

type RolloutRevision struct {
	Revision    int64  `json:"revision"`
	Name        string `json:"name"`
	Replicas    int32  `json:"replicas"`
	ChangeCause string `json:"changeCause"`
	Current     bool   `json:"current"`
	Age         int64  `json:"age"`
	Images      string `json:"images"`
}

func SetDeploymentPaused(ctx context.Context, k8sCfg *rest.Config, namespace, name string, paused bool) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"paused":%t}}`, paused))
	_, err = client.AppsV1().Deployments(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

func ListDeploymentRevisions(ctx context.Context, k8sCfg *rest.Config, namespace, name string) ([]RolloutRevision, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	dep, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	rss, err := listOwnedReplicaSets(ctx, client, dep)
	if err != nil {
		return nil, err
	}
	currentRev := revisionOf(dep.Annotations)

	revs := make([]RolloutRevision, 0, len(rss))
	for _, rs := range rss {
		rev := revisionOf(rs.Annotations)
		if rev == 0 {
			continue
		}
		revs = append(revs, RolloutRevision{
			Revision:    rev,
			Name:        rs.Name,
			Replicas:    derefInt32(rs.Spec.Replicas),
			ChangeCause: rs.Annotations[changeCauseAnnotation],
			Current:     rev == currentRev,
			Age:         rs.CreationTimestamp.Unix(),
			Images:      imagesFromTemplate(&rs.Spec.Template),
		})
	}
	sort.Slice(revs, func(i, j int) bool { return revs[i].Revision > revs[j].Revision })
	return revs, nil
}

// UndoDeploymentRollout rolls back to the previous revision (toRevision=0) or a specific revision.
func UndoDeploymentRollout(ctx context.Context, k8sCfg *rest.Config, namespace, name string, toRevision int64) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	dep, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if dep.Spec.Paused {
		return fmt.Errorf("cannot undo a paused deployment — resume it first")
	}

	rss, err := listOwnedReplicaSets(ctx, client, dep)
	if err != nil {
		return err
	}
	if len(rss) == 0 {
		return fmt.Errorf("no revisions found for deployment %q", name)
	}

	currentRev := revisionOf(dep.Annotations)
	var target *appsv1.ReplicaSet

	if toRevision > 0 {
		for i := range rss {
			if revisionOf(rss[i].Annotations) == toRevision {
				target = &rss[i]
				break
			}
		}
		if target == nil {
			return fmt.Errorf("revision %d not found", toRevision)
		}
	} else {
		// Previous revision: highest revision number below current
		var best int64
		for i := range rss {
			rev := revisionOf(rss[i].Annotations)
			if rev > 0 && rev < currentRev && rev > best {
				best = rev
				target = &rss[i]
			}
		}
		if target == nil {
			return fmt.Errorf("no previous revision to roll back to")
		}
	}

	if revisionOf(target.Annotations) == currentRev {
		return fmt.Errorf("already at revision %d", currentRev)
	}

	// Copy pod template from target ReplicaSet (same idea as kubectl rollout undo)
	newDep := dep.DeepCopy()
	tpl := target.Spec.Template.DeepCopy()
	newDep.Spec.Template.ObjectMeta = tpl.ObjectMeta
	newDep.Spec.Template.Spec = tpl.Spec
	if newDep.Spec.Template.Labels != nil {
		delete(newDep.Spec.Template.Labels, "pod-template-hash")
	}
	if cause := target.Annotations[changeCauseAnnotation]; cause != "" {
		newDep.Annotations = copyMap(newDep.Annotations)
		newDep.Annotations[changeCauseAnnotation] = cause
	}

	_, err = client.AppsV1().Deployments(namespace).Update(ctx, newDep, metav1.UpdateOptions{})
	return err
}

func listOwnedReplicaSets(ctx context.Context, client *kubernetes.Clientset, dep *appsv1.Deployment) ([]appsv1.ReplicaSet, error) {
	selector, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
	if err != nil {
		return nil, err
	}
	list, err := client.AppsV1().ReplicaSets(dep.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: selector.String(),
	})
	if err != nil {
		return nil, err
	}
	owned := make([]appsv1.ReplicaSet, 0, len(list.Items))
	for _, rs := range list.Items {
		if metav1.IsControlledBy(&rs, dep) {
			owned = append(owned, rs)
		}
	}
	return owned, nil
}

func revisionOf(ann map[string]string) int64 {
	if ann == nil {
		return 0
	}
	v, err := strconv.ParseInt(ann[revisionAnnotation], 10, 64)
	if err != nil {
		return 0
	}
	return v
}

func derefInt32(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

func imagesFromTemplate(tpl *corev1.PodTemplateSpec) string {
	if tpl == nil {
		return ""
	}
	imgs := make([]string, 0, len(tpl.Spec.Containers))
	for _, c := range tpl.Spec.Containers {
		imgs = append(imgs, c.Image)
	}
	return joinComma(imgs)
}

func joinComma(ss []string) string {
	if len(ss) == 0 {
		return ""
	}
	out := ss[0]
	for i := 1; i < len(ss); i++ {
		out += ", " + ss[i]
	}
	return out
}

func copyMap(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
