package services

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestResolveServiceTargetPort(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "app-pod"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "app",
				Ports: []corev1.ContainerPort{
					{Name: "http", ContainerPort: 8080},
					{Name: "metrics", ContainerPort: 9090},
				},
			}},
		},
	}

	tests := []struct {
		name        string
		svc         *corev1.Service
		pod         *corev1.Pod
		servicePort int
		want        int
		wantErr     string
	}{
		{
			name: "int targetPort",
			svc: &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{
				Port: 80, TargetPort: intstr.FromInt32(8080),
			}}}},
			pod: pod, servicePort: 80, want: 8080,
		},
		{
			name: "int targetPort zero uses service port",
			svc: &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{
				Port: 443, TargetPort: intstr.FromInt(0),
			}}}},
			pod: pod, servicePort: 443, want: 443,
		},
		{
			name: "named targetPort on pod",
			svc: &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{
				Port: 8080, TargetPort: intstr.FromString("http"),
			}}}},
			pod: pod, servicePort: 8080, want: 8080,
		},
		{
			name: "empty targetPort name uses service port",
			svc: &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{
				Port: 3000, TargetPort: intstr.IntOrString{Type: intstr.String, StrVal: ""},
			}}}},
			pod: pod, servicePort: 3000, want: 3000,
		},
		{
			name: "undeclared service port treated as container port",
			svc: &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{
				Port: 80, TargetPort: intstr.FromInt32(8080),
			}}}},
			pod: pod, servicePort: 9090, want: 9090,
		},
		{
			name: "named targetPort missing on pod",
			svc: &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{
				Port: 80, TargetPort: intstr.FromString("grpc"),
			}}}},
			pod: pod, servicePort: 80, wantErr: `named targetPort "grpc" not found on pod app-pod`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveServiceTargetPort(tt.svc, tt.pod, tt.servicePort)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatal("expected error")
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error %q, want substring %q", err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestPodPlainHTTP(t *testing.T) {
	tests := []struct {
		name string
		pod  *corev1.Pod
		want bool
	}{
		{"nil pod", nil, false},
		{"plain pod", &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}}}, false},
		{"argocd insecure flag", &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Args: []string{"server", "--insecure"},
		}}}}, true},
		{"insecure equals true", &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Args: []string{"--insecure=TRUE"},
		}}}}, true},
		{"ARGOCD_SERVER_INSECURE env", &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Env: []corev1.EnvVar{{Name: "ARGOCD_SERVER_INSECURE", Value: "yes"}},
		}}}}, true},
		{"SERVER_INSECURE env", &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Env: []corev1.EnvVar{{Name: "SERVER_INSECURE", Value: "1"}},
		}}}}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := podPlainHTTP(tt.pod); got != tt.want {
				t.Fatalf("podPlainHTTP() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSuggestScheme(t *testing.T) {
	plainHTTPPod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{
		Args: []string{"--insecure"},
	}}}}
	tlsRemapPod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}}}

	tests := []struct {
		name          string
		requestedPort int
		containerPort int
		pod           *corev1.Pod
		want          string
	}{
		{"plain HTTP pod forces http", 443, 8080, plainHTTPPod, "http"},
		{"TLS container port", 8080, 443, tlsRemapPod, "https"},
		{"TLS service port remap to plain container", 443, 8080, tlsRemapPod, "https"},
		{"common HTTPS ports on container", 8443, 8443, tlsRemapPod, "https"},
		{"default http", 8080, 8080, tlsRemapPod, "http"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := suggestScheme(tt.requestedPort, tt.containerPort, tt.pod); got != tt.want {
				t.Fatalf("suggestScheme(%d, %d) = %q, want %q", tt.requestedPort, tt.containerPort, got, tt.want)
			}
		})
	}
}
