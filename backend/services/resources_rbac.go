package services

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listClusterRoles(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, cr := range list.Items {
		items = append(items, ResourceRow{
			Name: cr.Name,
			Age:  cr.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"rules": fmt.Sprintf("%d", len(cr.Rules)),
			},
		})
	}
	return &ResourceList{Kind: "clusterroles", Items: items}, nil
}

func listRoles(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.RbacV1().Roles(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, r := range list.Items {
		items = append(items, ResourceRow{
			Name:      r.Name,
			Namespace: r.Namespace,
			Age:       r.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"rules": fmt.Sprintf("%d", len(r.Rules)),
			},
		})
	}
	return &ResourceList{Kind: "roles", Items: items}, nil
}

func listClusterRoleBindings(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, crb := range list.Items {
		items = append(items, ResourceRow{
			Name: crb.Name,
			Age:  crb.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"role":     crb.RoleRef.Name,
				"subjects": fmt.Sprintf("%d", len(crb.Subjects)),
			},
		})
	}
	return &ResourceList{Kind: "clusterrolebindings", Items: items}, nil
}

func listRoleBindings(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, rb := range list.Items {
		items = append(items, ResourceRow{
			Name:      rb.Name,
			Namespace: rb.Namespace,
			Age:       rb.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"role":     rb.RoleRef.Name,
				"subjects": fmt.Sprintf("%d", len(rb.Subjects)),
			},
		})
	}
	return &ResourceList{Kind: "rolebindings", Items: items}, nil
}
