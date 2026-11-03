package services

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type Application struct {
	Name            string   `json:"name"`
	Namespace       string   `json:"namespace"`
	Kind            string   `json:"kind"` // "Deployment" | "StatefulSet"
	ReadyReplicas   int32    `json:"readyReplicas"`
	DesiredReplicas int32    `json:"desiredReplicas"`
	Age             int64    `json:"age"`
	Images          []string `json:"images"`
}

type ApplicationList struct {
	Items []Application `json:"items"`
}

func ListApplications(ctx context.Context, k8sCfg *rest.Config) (*ApplicationList, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create k8s client: %w", err)
	}

	items := []Application{}

	deps, err := client.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	for _, d := range deps.Items {
		desired := int32(1)
		if d.Spec.Replicas != nil {
			desired = *d.Spec.Replicas
		}
		images := []string{}
		for _, c := range d.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}
		items = append(items, Application{
			Name:            d.Name,
			Namespace:       d.Namespace,
			Kind:            "Deployment",
			ReadyReplicas:   d.Status.ReadyReplicas,
			DesiredReplicas: desired,
			Age:             d.CreationTimestamp.Unix(),
			Images:          images,
		})
	}

	stss, err := client.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list statefulsets: %w", err)
	}
	for _, ss := range stss.Items {
		desired := int32(1)
		if ss.Spec.Replicas != nil {
			desired = *ss.Spec.Replicas
		}
		images := []string{}
		for _, c := range ss.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}
		items = append(items, Application{
			Name:            ss.Name,
			Namespace:       ss.Namespace,
			Kind:            "StatefulSet",
			ReadyReplicas:   ss.Status.ReadyReplicas,
			DesiredReplicas: desired,
			Age:             ss.CreationTimestamp.Unix(),
			Images:          images,
		})
	}

	return &ApplicationList{Items: items}, nil
}
