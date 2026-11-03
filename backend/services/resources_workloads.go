package services

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listDeployments(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, d := range list.Items {
		desired := int32(1)
		if d.Spec.Replicas != nil {
			desired = *d.Spec.Replicas
		}
		imgParts := make([]string, 0, len(d.Spec.Template.Spec.Containers))
		for _, c := range d.Spec.Template.Spec.Containers {
			parts := strings.Split(c.Image, "/")
			imgParts = append(imgParts, parts[len(parts)-1])
		}
		imagesStr := strings.Join(imgParts, ", ")
		paused := "False"
		if d.Spec.Paused {
			paused = "True"
		}
		items = append(items, ResourceRow{
			Name:      d.Name,
			Namespace: d.Namespace,
			Age:       d.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"status":    deploymentStatus(d.Status, desired),
				"ready":     fmt.Sprintf("%d/%d", minInt32(d.Status.ReadyReplicas, d.Status.UpdatedReplicas), desired),
				"upToDate":  fmt.Sprintf("%d", d.Status.UpdatedReplicas),
				"available": fmt.Sprintf("%d", d.Status.AvailableReplicas),
				"images":    imagesStr,
				"strategy":  string(d.Spec.Strategy.Type),
				"paused":    paused,
			},
		})
	}
	return &ResourceList{Kind: "deployments", Items: items}, nil
}

func listDaemonSets(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, ds := range list.Items {
		imgParts := make([]string, 0, len(ds.Spec.Template.Spec.Containers))
		for _, c := range ds.Spec.Template.Spec.Containers {
			parts := strings.Split(c.Image, "/")
			imgParts = append(imgParts, parts[len(parts)-1])
		}
		items = append(items, ResourceRow{
			Name:      ds.Name,
			Namespace: ds.Namespace,
			Age:       ds.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"desired":   fmt.Sprintf("%d", ds.Status.DesiredNumberScheduled),
				"ready":     fmt.Sprintf("%d", ds.Status.NumberReady),
				"upToDate":  fmt.Sprintf("%d", ds.Status.UpdatedNumberScheduled),
				"available": fmt.Sprintf("%d", ds.Status.NumberAvailable),
				"images":    strings.Join(imgParts, ", "),
			},
		})
	}
	return &ResourceList{Kind: "daemonsets", Items: items}, nil
}

func listStatefulSets(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, ss := range list.Items {
		desired := int32(1)
		if ss.Spec.Replicas != nil {
			desired = *ss.Spec.Replicas
		}
		imgParts := make([]string, 0, len(ss.Spec.Template.Spec.Containers))
		for _, c := range ss.Spec.Template.Spec.Containers {
			parts := strings.Split(c.Image, "/")
			imgParts = append(imgParts, parts[len(parts)-1])
		}
		items = append(items, ResourceRow{
			Name:      ss.Name,
			Namespace: ss.Namespace,
			Age:       ss.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"ready":       fmt.Sprintf("%d/%d", ss.Status.ReadyReplicas, desired),
				"serviceName": ss.Spec.ServiceName,
				"images":      strings.Join(imgParts, ", "),
			},
		})
	}
	return &ResourceList{Kind: "statefulsets", Items: items}, nil
}

func listReplicaSets(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, rs := range list.Items {
		desired := int32(1)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}
		imgParts := make([]string, 0, len(rs.Spec.Template.Spec.Containers))
		for _, c := range rs.Spec.Template.Spec.Containers {
			parts := strings.Split(c.Image, "/")
			imgParts = append(imgParts, parts[len(parts)-1])
		}
		items = append(items, ResourceRow{
			Name:      rs.Name,
			Namespace: rs.Namespace,
			Age:       rs.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"desired":   fmt.Sprintf("%d", desired),
				"ready":     fmt.Sprintf("%d", rs.Status.ReadyReplicas),
				"available": fmt.Sprintf("%d", rs.Status.AvailableReplicas),
				"images":    strings.Join(imgParts, ", "),
			},
		})
	}
	return &ResourceList{Kind: "replicasets", Items: items}, nil
}

func listJobs(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, j := range list.Items {
		completions := int32(1)
		if j.Spec.Completions != nil {
			completions = *j.Spec.Completions
		}
		duration := ""
		if j.Status.StartTime != nil {
			end := metav1.Now()
			if j.Status.CompletionTime != nil {
				end = *j.Status.CompletionTime
			}
			d := end.Sub(j.Status.StartTime.Time)
			switch {
			case d.Hours() >= 1:
				duration = fmt.Sprintf("%.0fh", d.Hours())
			case d.Minutes() >= 1:
				duration = fmt.Sprintf("%.0fm", d.Minutes())
			default:
				duration = fmt.Sprintf("%.0fs", d.Seconds())
			}
		}
		jobStatus := "Active"
		if j.Spec.Suspend != nil && *j.Spec.Suspend {
			jobStatus = "Suspended"
		} else {
			for _, c := range j.Status.Conditions {
				if c.Status == corev1.ConditionTrue {
					switch string(c.Type) {
					case "Complete":
						jobStatus = "Complete"
					case "Failed":
						jobStatus = "Failed"
					case "Suspended":
						jobStatus = "Suspended"
					}
				}
			}
		}
		items = append(items, ResourceRow{
			Name:      j.Name,
			Namespace: j.Namespace,
			Age:       j.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"completions": fmt.Sprintf("%d/%d", j.Status.Succeeded, completions),
				"duration":    duration,
				"active":      fmt.Sprintf("%d", j.Status.Active),
				"status":      jobStatus,
			},
		})
	}
	return &ResourceList{Kind: "jobs", Items: items}, nil
}

func listCronJobs(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, cj := range list.Items {
		lastRun := ""
		if cj.Status.LastScheduleTime != nil {
			lastRun = fmt.Sprintf("%d", cj.Status.LastScheduleTime.Unix())
		}
		suspended := "False"
		if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
			suspended = "True"
		}
		items = append(items, ResourceRow{
			Name:      cj.Name,
			Namespace: cj.Namespace,
			Age:       cj.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"schedule":  cj.Spec.Schedule,
				"lastRun":   lastRun,
				"suspended": suspended,
				"active":    fmt.Sprintf("%d", len(cj.Status.Active)),
			},
		})
	}
	return &ResourceList{Kind: "cronjobs", Items: items}, nil
}
