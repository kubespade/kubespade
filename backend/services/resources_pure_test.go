package services

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func i32p(v int32) *int32 { return &v }

func TestMinInt32(t *testing.T) {
	if got := minInt32(3, 5); got != 3 {
		t.Errorf("minInt32(3,5)=%d want 3", got)
	}
	if got := minInt32(5, 3); got != 3 {
		t.Errorf("minInt32(5,3)=%d want 3", got)
	}
	if got := minInt32(4, 4); got != 4 {
		t.Errorf("minInt32(4,4)=%d want 4", got)
	}
}

func TestContainerDotColor(t *testing.T) {
	tests := []struct {
		name string
		cs   corev1.ContainerStatus
		want string
	}{
		{
			name: "running ready → green",
			cs:   corev1.ContainerStatus{Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
			want: "g",
		},
		{
			name: "terminated exit 0 → gray",
			cs:   corev1.ContainerStatus{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 0}}},
			want: "s",
		},
		{
			name: "terminated exit 1 → red",
			cs:   corev1.ContainerStatus{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 1}}},
			want: "r",
		},
		{
			name: "waiting CrashLoopBackOff → red",
			cs:   corev1.ContainerStatus{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}},
			want: "r",
		},
		{
			name: "waiting benign reason → yellow",
			cs:   corev1.ContainerStatus{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}},
			want: "y",
		},
		{
			name: "running not ready → yellow",
			cs:   corev1.ContainerStatus{Ready: false, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
			want: "y",
		},
		{
			name: "empty state → yellow",
			cs:   corev1.ContainerStatus{},
			want: "y",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := containerDotColor(tt.cs); got != tt.want {
				t.Errorf("containerDotColor = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestIsPodReady(t *testing.T) {
	ready := corev1.Pod{Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}}}
	notReady := corev1.Pod{Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}}}}
	noCond := corev1.Pod{}
	if !isPodReady(ready) {
		t.Error("expected ready")
	}
	if isPodReady(notReady) {
		t.Error("expected not ready")
	}
	if isPodReady(noCond) {
		t.Error("expected not ready when no condition")
	}
}

func TestComputePodStatus(t *testing.T) {
	now := metav1.Now()
	tests := []struct {
		name string
		pod  corev1.Pod
		want string
	}{
		{
			name: "terminating",
			pod:  corev1.Pod{ObjectMeta: metav1.ObjectMeta{DeletionTimestamp: &now}},
			want: "Terminating",
		},
		{
			name: "evicted",
			pod:  corev1.Pod{Status: corev1.PodStatus{Reason: "Evicted"}},
			want: "Evicted",
		},
		{
			name: "init container failed terminated",
			pod: corev1.Pod{Status: corev1.PodStatus{
				InitContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 1, Reason: "Error"}}},
				},
			}},
			want: "Init:Error",
		},
		{
			name: "init container waiting reason",
			pod: corev1.Pod{Spec: corev1.PodSpec{InitContainers: []corev1.Container{{}, {}}}, Status: corev1.PodStatus{
				InitContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ImagePullBackOff"}}},
				},
			}},
			want: "Init:ImagePullBackOff",
		},
		{
			name: "init container still initializing",
			pod: corev1.Pod{Spec: corev1.PodSpec{InitContainers: []corev1.Container{{}, {}}}, Status: corev1.PodStatus{
				InitContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "PodInitializing"}}},
				},
			}},
			want: "Init:0/2",
		},
		{
			name: "init completed then container waiting",
			pod: corev1.Pod{Status: corev1.PodStatus{
				InitContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 0}}},
				},
				ContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}},
				},
			}},
			want: "CrashLoopBackOff",
		},
		{
			name: "container terminated nonzero with reason",
			pod: corev1.Pod{Status: corev1.PodStatus{
				ContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 137, Reason: "OOMKilled"}}},
				},
			}},
			want: "OOMKilled",
		},
		{
			name: "container terminated nonzero no reason",
			pod: corev1.Pod{Status: corev1.PodStatus{
				ContainerStatuses: []corev1.ContainerStatus{
					{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 2}}},
				},
			}},
			want: "ExitCode:2",
		},
		{
			name: "running and ready",
			pod: corev1.Pod{Status: corev1.PodStatus{
				Phase:      corev1.PodRunning,
				Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
			}},
			want: "Running",
		},
		{
			name: "running but not ready → NotReady",
			pod: corev1.Pod{Status: corev1.PodStatus{
				Phase:      corev1.PodRunning,
				Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
			}},
			want: "NotReady",
		},
		{
			name: "succeeded phase",
			pod:  corev1.Pod{Status: corev1.PodStatus{Phase: corev1.PodSucceeded}},
			want: "Succeeded",
		},
		{
			name: "empty phase → Unknown",
			pod:  corev1.Pod{},
			want: "Unknown",
		},
		{
			name: "sidecar init ready is skipped, then Running",
			pod: corev1.Pod{Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				InitContainerStatuses: []corev1.ContainerStatus{
					{Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
				},
				Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
			}},
			want: "Running",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := computePodStatus(tt.pod); got != tt.want {
				t.Errorf("computePodStatus = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestLastRestartReason(t *testing.T) {
	older := metav1.NewTime(time.Unix(100, 0))
	newer := metav1.NewTime(time.Unix(200, 0))
	pod := corev1.Pod{Status: corev1.PodStatus{
		ContainerStatuses: []corev1.ContainerStatus{
			{LastTerminationState: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{Reason: "Error", FinishedAt: older},
			}},
			{LastTerminationState: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: newer},
			}},
		},
	}}
	if got := lastRestartReason(pod); got != "OOMKilled" {
		t.Fatalf("lastRestartReason = %q, want OOMKilled", got)
	}
	if got := lastRestartReason(corev1.Pod{}); got != "" {
		t.Fatalf("empty pod reason = %q", got)
	}
}

func TestPodResourceTotals(t *testing.T) {
	pod := corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{
		{Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("100m"),
				corev1.ResourceMemory: resource.MustParse("128Mi"),
			},
			Limits: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("500m"),
				corev1.ResourceMemory: resource.MustParse("256Mi"),
			},
		}},
		{Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("50m")},
			Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("64Mi")},
		}},
	}}}
	cpuReq, cpuLim, memReq, memLim := podResourceTotals(pod)
	if cpuReq != 150 || cpuLim != 500 {
		t.Fatalf("cpu req/lim = %d/%d, want 150/500", cpuReq, cpuLim)
	}
	if memReq != 128*1024*1024 || memLim != (256+64)*1024*1024 {
		t.Fatalf("mem req/lim = %d/%d", memReq, memLim)
	}
}

func TestDeploymentStatus(t *testing.T) {
	progressFailed := appsv1.DeploymentStatus{
		Conditions: []appsv1.DeploymentCondition{{Type: appsv1.DeploymentProgressing, Reason: "ProgressDeadlineExceeded"}},
	}
	tests := []struct {
		name    string
		status  appsv1.DeploymentStatus
		desired int32
		want    string
	}{
		{"progress deadline exceeded", progressFailed, 3, "Failed"},
		{"scaled down", appsv1.DeploymentStatus{}, 0, "Scaled Down"},
		{"fully ready", appsv1.DeploymentStatus{ReadyReplicas: 3, UpdatedReplicas: 3, AvailableReplicas: 3}, 3, "Ready"},
		{"rolling (updated<desired, ready>=desired)", appsv1.DeploymentStatus{ReadyReplicas: 3, UpdatedReplicas: 1}, 3, "Rolling"},
		{"progressing (updated<desired, ready<desired)", appsv1.DeploymentStatus{ReadyReplicas: 1, UpdatedReplicas: 1}, 3, "Progressing"},
		{"unavailable (updated done, none ready)", appsv1.DeploymentStatus{ReadyReplicas: 0, UpdatedReplicas: 3}, 3, "Unavailable"},
		{"degraded (updated done, some ready)", appsv1.DeploymentStatus{ReadyReplicas: 2, UpdatedReplicas: 3}, 3, "Degraded"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := deploymentStatus(tt.status, tt.desired); got != tt.want {
				t.Errorf("deploymentStatus = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatHPAMetricTarget(t *testing.T) {
	avgVal := resource.MustParse("100Mi")
	val := resource.MustParse("500m")
	tests := []struct {
		name string
		t    autoscalingv2.MetricTarget
		want string
	}{
		{"utilization", autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType, AverageUtilization: i32p(80)}, "80%"},
		{"average value", autoscalingv2.MetricTarget{Type: autoscalingv2.AverageValueMetricType, AverageValue: &avgVal}, "100Mi"},
		{"value", autoscalingv2.MetricTarget{Type: autoscalingv2.ValueMetricType, Value: &val}, "500m"},
		{"empty → dash", autoscalingv2.MetricTarget{}, "—"},
		{"utilization type without value falls through to nil checks", autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType}, "—"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatHPAMetricTarget(tt.t); got != tt.want {
				t.Errorf("formatHPAMetricTarget = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatHPAMetricCurrent(t *testing.T) {
	avgVal := resource.MustParse("50Mi")
	val := resource.MustParse("250m")
	if got := formatHPAMetricCurrent(autoscalingv2.MetricValueStatus{AverageUtilization: i32p(42)}); got != "42%" {
		t.Errorf("utilization = %q", got)
	}
	if got := formatHPAMetricCurrent(autoscalingv2.MetricValueStatus{AverageValue: &avgVal}); got != "50Mi" {
		t.Errorf("avg value = %q", got)
	}
	if got := formatHPAMetricCurrent(autoscalingv2.MetricValueStatus{Value: &val}); got != "250m" {
		t.Errorf("value = %q", got)
	}
	if got := formatHPAMetricCurrent(autoscalingv2.MetricValueStatus{}); got != "—" {
		t.Errorf("empty = %q", got)
	}
}

func TestShortHPAListName(t *testing.T) {
	tests := []struct {
		name string
		in   string
		typ  autoscalingv2.MetricSourceType
		want string
	}{
		{"memory resource → mem", "memory", autoscalingv2.ResourceMetricSourceType, "mem"},
		{"cpu resource unchanged", "cpu", autoscalingv2.ResourceMetricSourceType, "cpu"},
		{"container suffix dropped", "cpu (sidecar)", autoscalingv2.ContainerResourceMetricSourceType, "cpu"},
		{"short external name unchanged", "queue_depth", autoscalingv2.ExternalMetricSourceType, "queue_depth"},
		{"long external name truncated", "verylongmetricnamehere", autoscalingv2.ExternalMetricSourceType, "verylong…amehere"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shortHPAListName(tt.in, tt.typ); got != tt.want {
				t.Errorf("shortHPAListName(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestHPAMetricSpecParts(t *testing.T) {
	cpu := resource.MustParse("100m")
	t.Run("resource cpu", func(t *testing.T) {
		name, target, key := hpaMetricSpecParts(autoscalingv2.MetricSpec{
			Type:     autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricSource{Name: corev1.ResourceCPU, Target: autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType, AverageUtilization: i32p(70)}},
		})
		if name != "cpu" || target != "70%" || key != "Resource:cpu" {
			t.Errorf("got name=%q target=%q key=%q", name, target, key)
		}
	})
	t.Run("container resource with container", func(t *testing.T) {
		name, target, key := hpaMetricSpecParts(autoscalingv2.MetricSpec{
			Type:              autoscalingv2.ContainerResourceMetricSourceType,
			ContainerResource: &autoscalingv2.ContainerResourceMetricSource{Name: corev1.ResourceCPU, Container: "app", Target: autoscalingv2.MetricTarget{Type: autoscalingv2.AverageValueMetricType, AverageValue: &cpu}},
		})
		if name != "cpu (app)" || target != "100m" || key != "ContainerResource:cpu (app)" {
			t.Errorf("got name=%q target=%q key=%q", name, target, key)
		}
	})
	t.Run("pods metric", func(t *testing.T) {
		name, _, key := hpaMetricSpecParts(autoscalingv2.MetricSpec{
			Type: autoscalingv2.PodsMetricSourceType,
			Pods: &autoscalingv2.PodsMetricSource{Metric: autoscalingv2.MetricIdentifier{Name: "reqs"}, Target: autoscalingv2.MetricTarget{Type: autoscalingv2.AverageValueMetricType, AverageValue: &cpu}},
		})
		if name != "reqs" || key != "Pods:reqs" {
			t.Errorf("got name=%q key=%q", name, key)
		}
	})
	t.Run("object metric", func(t *testing.T) {
		name, _, key := hpaMetricSpecParts(autoscalingv2.MetricSpec{
			Type:   autoscalingv2.ObjectMetricSourceType,
			Object: &autoscalingv2.ObjectMetricSource{Metric: autoscalingv2.MetricIdentifier{Name: "lat"}, Target: autoscalingv2.MetricTarget{Type: autoscalingv2.ValueMetricType, Value: &cpu}},
		})
		if name != "lat" || key != "Object:lat" {
			t.Errorf("got name=%q key=%q", name, key)
		}
	})
	t.Run("external metric", func(t *testing.T) {
		name, _, key := hpaMetricSpecParts(autoscalingv2.MetricSpec{
			Type:     autoscalingv2.ExternalMetricSourceType,
			External: &autoscalingv2.ExternalMetricSource{Metric: autoscalingv2.MetricIdentifier{Name: "q"}, Target: autoscalingv2.MetricTarget{Type: autoscalingv2.ValueMetricType, Value: &cpu}},
		})
		if name != "q" || key != "External:q" {
			t.Errorf("got name=%q key=%q", name, key)
		}
	})
	t.Run("unknown/nil → type fallback", func(t *testing.T) {
		name, target, key := hpaMetricSpecParts(autoscalingv2.MetricSpec{Type: autoscalingv2.ResourceMetricSourceType})
		if name != "Resource" || target != "—" || key != "Resource:" {
			t.Errorf("got name=%q target=%q key=%q", name, target, key)
		}
	})
}

func TestHPAMetricStatusParts(t *testing.T) {
	cpu := resource.MustParse("42m")
	t.Run("resource", func(t *testing.T) {
		name, current, key := hpaMetricStatusParts(autoscalingv2.MetricStatus{
			Type:     autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricStatus{Name: corev1.ResourceCPU, Current: autoscalingv2.MetricValueStatus{AverageUtilization: i32p(55)}},
		})
		if name != "cpu" || current != "55%" || key != "Resource:cpu" {
			t.Errorf("got name=%q current=%q key=%q", name, current, key)
		}
	})
	t.Run("external with value", func(t *testing.T) {
		name, current, key := hpaMetricStatusParts(autoscalingv2.MetricStatus{
			Type:     autoscalingv2.ExternalMetricSourceType,
			External: &autoscalingv2.ExternalMetricStatus{Metric: autoscalingv2.MetricIdentifier{Name: "q"}, Current: autoscalingv2.MetricValueStatus{Value: &cpu}},
		})
		if name != "q" || current != "42m" || key != "External:q" {
			t.Errorf("got name=%q current=%q key=%q", name, current, key)
		}
	})
	t.Run("nil fallback", func(t *testing.T) {
		name, current, key := hpaMetricStatusParts(autoscalingv2.MetricStatus{Type: autoscalingv2.PodsMetricSourceType})
		if name != "Pods" || current != "—" || key != "Pods:" {
			t.Errorf("got name=%q current=%q key=%q", name, current, key)
		}
	})
}

func TestFormatHPAMetricsSummary(t *testing.T) {
	t.Run("empty → dash", func(t *testing.T) {
		if got := formatHPAMetricsSummary(nil, nil); got != "—" {
			t.Errorf("got %q, want —", got)
		}
	})
	t.Run("spec matched with status", func(t *testing.T) {
		specs := []autoscalingv2.MetricSpec{{
			Type:     autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricSource{Name: corev1.ResourceCPU, Target: autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType, AverageUtilization: i32p(80)}},
		}}
		status := []autoscalingv2.MetricStatus{{
			Type:     autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricStatus{Name: corev1.ResourceCPU, Current: autoscalingv2.MetricValueStatus{AverageUtilization: i32p(40)}},
		}}
		if got := formatHPAMetricsSummary(specs, status); got != "cpu 40%/80%" {
			t.Errorf("got %q, want %q", got, "cpu 40%/80%")
		}
	})
	t.Run("spec without status → dash current", func(t *testing.T) {
		specs := []autoscalingv2.MetricSpec{{
			Type:     autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricSource{Name: corev1.ResourceMemory, Target: autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType, AverageUtilization: i32p(75)}},
		}}
		if got := formatHPAMetricsSummary(specs, nil); got != "mem —/75%" {
			t.Errorf("got %q, want %q", got, "mem —/75%")
		}
	})
}
