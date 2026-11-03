package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
)

func RestartWorkload(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name string) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	ts := time.Now().UTC().Format(time.RFC3339)
	patch := []byte(fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":%q}}}}}`, ts))
	switch kind {
	case "deployments":
		_, err = client.AppsV1().Deployments(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	case "statefulsets":
		_, err = client.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	case "daemonsets":
		_, err = client.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	default:
		return fmt.Errorf("restart not supported for %s", kind)
	}
	return err
}

func ScaleWorkload(ctx context.Context, k8sCfg *rest.Config, kind, namespace, name string, replicas int32) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicas))
	switch kind {
	case "deployments":
		_, err = client.AppsV1().Deployments(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	case "statefulsets":
		_, err = client.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	case "daemonsets":
		_, err = client.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	case "replicasets":
		_, err = client.AppsV1().ReplicaSets(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	default:
		return fmt.Errorf("scale not supported for %s", kind)
	}
	return err
}

func EvictPod(ctx context.Context, k8sCfg *rest.Config, namespace, podName string) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	eviction := &policyv1.Eviction{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: namespace,
		},
	}
	return client.PolicyV1().Evictions(namespace).Evict(ctx, eviction)
}

func SetCronJobSuspend(ctx context.Context, k8sCfg *rest.Config, namespace, name string, suspend bool) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"suspend":%t}}`, suspend))
	_, err = client.BatchV1().CronJobs(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

// TriggerCronJob creates a one-off Job from a CronJob's jobTemplate (kubectl create job --from=cronjob/…).
func TriggerCronJob(ctx context.Context, k8sCfg *rest.Config, namespace, name string) (string, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return "", err
	}
	cj, err := client.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}

	jobName := fmt.Sprintf("%s-manual-%d", name, time.Now().Unix())
	if len(jobName) > 63 {
		jobName = jobName[:63]
		jobName = strings.TrimRight(jobName, "-")
	}

	annotations := map[string]string{
		"cronjob.kubernetes.io/instantiate": "manual",
	}
	for k, v := range cj.Spec.JobTemplate.Annotations {
		annotations[k] = v
	}

	labels := map[string]string{}
	for k, v := range cj.Spec.JobTemplate.Labels {
		labels[k] = v
	}

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:        jobName,
			Namespace:   namespace,
			Labels:      labels,
			Annotations: annotations,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(cj, batchv1.SchemeGroupVersion.WithKind("CronJob")),
			},
		},
		Spec: *cj.Spec.JobTemplate.Spec.DeepCopy(),
	}

	created, err := client.BatchV1().Jobs(namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return "", err
	}
	return created.Name, nil
}
