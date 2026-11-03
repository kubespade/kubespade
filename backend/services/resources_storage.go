package services

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listStorageClasses(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, sc := range list.Items {
		bindingMode := "Immediate"
		if sc.VolumeBindingMode != nil {
			bindingMode = string(*sc.VolumeBindingMode)
		}
		reclaimPolicy := "Delete"
		if sc.ReclaimPolicy != nil {
			reclaimPolicy = string(*sc.ReclaimPolicy)
		}
		allowExpansion := "false"
		if sc.AllowVolumeExpansion != nil && *sc.AllowVolumeExpansion {
			allowExpansion = "true"
		}
		items = append(items, ResourceRow{
			Name: sc.Name,
			Age:  sc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"provisioner":    sc.Provisioner,
				"reclaimPolicy":  reclaimPolicy,
				"bindingMode":    bindingMode,
				"allowExpansion": allowExpansion,
			},
		})
	}
	return &ResourceList{Kind: "storageclasses", Items: items}, nil
}

func listCSIDrivers(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.StorageV1().CSIDrivers().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, d := range list.Items {
		attachRequired := "false"
		if d.Spec.AttachRequired != nil && *d.Spec.AttachRequired {
			attachRequired = "true"
		}
		podInfoOnMount := "false"
		if d.Spec.PodInfoOnMount != nil && *d.Spec.PodInfoOnMount {
			podInfoOnMount = "true"
		}
		items = append(items, ResourceRow{
			Name: d.Name,
			Age:  d.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"attachRequired": attachRequired,
				"podInfoOnMount": podInfoOnMount,
			},
		})
	}
	return &ResourceList{Kind: "csidrivers", Items: items}, nil
}

func listCSINodes(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.StorageV1().CSINodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, n := range list.Items {
		items = append(items, ResourceRow{
			Name: n.Name,
			Age:  n.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"drivers": fmt.Sprintf("%d", len(n.Spec.Drivers)),
			},
		})
	}
	return &ResourceList{Kind: "csinodes", Items: items}, nil
}

func listVolumeAttachments(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.StorageV1().VolumeAttachments().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, va := range list.Items {
		pvName := ""
		if va.Spec.Source.PersistentVolumeName != nil {
			pvName = *va.Spec.Source.PersistentVolumeName
		}
		attached := "false"
		if va.Status.Attached {
			attached = "true"
		}
		items = append(items, ResourceRow{
			Name: va.Name,
			Age:  va.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"attacher": va.Spec.Attacher,
				"nodeName": va.Spec.NodeName,
				"pvName":   pvName,
				"attached": attached,
			},
		})
	}
	return &ResourceList{Kind: "volumeattachments", Items: items}, nil
}

func listCSIStorageCapacities(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.StorageV1().CSIStorageCapacities(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, c := range list.Items {
		capacity := "<unknown>"
		if c.Capacity != nil {
			capacity = c.Capacity.String()
		}
		items = append(items, ResourceRow{
			Name:      c.Name,
			Namespace: c.Namespace,
			Age:       c.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"storageClass": c.StorageClassName,
				"capacity":     capacity,
			},
		})
	}
	return &ResourceList{Kind: "csistoragecapacities", Items: items}, nil
}
