package services

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestMatchWorkloadsEmptySelector(t *testing.T) {
	all := []workload{
		{id: "Deployment/a/x", kind: "Deployment", name: "x", namespace: "a", labels: map[string]string{"app": "x"}},
		{id: "Deployment/b/y", kind: "Deployment", name: "y", namespace: "b", labels: map[string]string{"app": "y"}},
	}
	got := matchWorkloads(all, "a", metav1.LabelSelector{})
	if len(got) != 1 || got[0].name != "x" {
		t.Fatalf("empty selector in ns a: got %#v", got)
	}
}

func TestMatchWorkloadsByLabel(t *testing.T) {
	all := []workload{
		{id: "Deployment/a/x", kind: "Deployment", name: "x", namespace: "a", labels: map[string]string{"app": "api"}},
		{id: "Deployment/a/z", kind: "Deployment", name: "z", namespace: "a", labels: map[string]string{"app": "web"}},
	}
	got := matchWorkloads(all, "a", metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}})
	if len(got) != 1 || got[0].name != "x" {
		t.Fatalf("label match: got %#v", got)
	}
}

func TestFormatPorts(t *testing.T) {
	proto := corev1.ProtocolTCP
	port := intstr.FromInt(80)
	s := formatPorts([]networkingv1.NetworkPolicyPort{{Protocol: &proto, Port: &port}})
	if s != "TCP/80" {
		t.Fatalf("got %q", s)
	}
}
