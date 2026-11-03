package services

import (
	"context"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listIngresses(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, ing := range list.Items {
		hosts := []string{}
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				hosts = append(hosts, rule.Host)
			}
		}
		hostsStr := strings.Join(hosts, ", ")
		if hostsStr == "" {
			hostsStr = "*"
		}
		address := ""
		for _, lbIng := range ing.Status.LoadBalancer.Ingress {
			if lbIng.IP != "" {
				address = lbIng.IP
				break
			}
			if lbIng.Hostname != "" {
				address = lbIng.Hostname
				break
			}
		}
		ingressClass := ""
		if ing.Spec.IngressClassName != nil {
			ingressClass = *ing.Spec.IngressClassName
		}
		tls := "false"
		if len(ing.Spec.TLS) > 0 {
			tls = "true"
		}
		items = append(items, ResourceRow{
			Name:      ing.Name,
			Namespace: ing.Namespace,
			Age:       ing.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"class":   ingressClass,
				"hosts":   hostsStr,
				"address": address,
				"tls":     tls,
			},
		})
	}
	return &ResourceList{Kind: "ingresses", Items: items}, nil
}

func listIngressClasses(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.NetworkingV1().IngressClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, ic := range list.Items {
		isDefault := "false"
		if ic.Annotations["ingressclass.kubernetes.io/is-default-class"] == "true" {
			isDefault = "true"
		}
		items = append(items, ResourceRow{
			Name: ic.Name,
			Age:  ic.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"controller": ic.Spec.Controller,
				"default":    isDefault,
			},
		})
	}
	return &ResourceList{Kind: "ingressclasses", Items: items}, nil
}

func listNetworkPolicies(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.NetworkingV1().NetworkPolicies(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, np := range list.Items {
		types := []string{}
		for _, pt := range np.Spec.PolicyTypes {
			types = append(types, string(pt))
		}
		typesStr := strings.Join(types, ", ")
		if typesStr == "" {
			typesStr = "Ingress"
		}
		podSelector := "All Pods"
		if len(np.Spec.PodSelector.MatchLabels) > 0 || len(np.Spec.PodSelector.MatchExpressions) > 0 {
			parts := []string{}
			for k, v := range np.Spec.PodSelector.MatchLabels {
				parts = append(parts, fmt.Sprintf("%s=%s", k, v))
			}
			podSelector = strings.Join(parts, ", ")
		}
		items = append(items, ResourceRow{
			Name:      np.Name,
			Namespace: np.Namespace,
			Age:       np.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"podSelector": podSelector,
				"policyTypes": typesStr,
			},
		})
	}
	return &ResourceList{Kind: "networkpolicies", Items: items}, nil
}

func listEndpointSlices(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, es := range list.Items {
		ports := []string{}
		for _, p := range es.Ports {
			if p.Port != nil {
				if p.Name != nil && *p.Name != "" {
					ports = append(ports, fmt.Sprintf("%s:%d", *p.Name, *p.Port))
				} else {
					ports = append(ports, fmt.Sprintf("%d", *p.Port))
				}
			}
		}
		portsStr := strings.Join(ports, ", ")
		if portsStr == "" {
			portsStr = "<none>"
		}
		items = append(items, ResourceRow{
			Name:      es.Name,
			Namespace: es.Namespace,
			Age:       es.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"addressType": string(es.AddressType),
				"endpoints":   fmt.Sprintf("%d", len(es.Endpoints)),
				"ports":       portsStr,
			},
		})
	}
	return &ResourceList{Kind: "endpointslices", Items: items}, nil
}
