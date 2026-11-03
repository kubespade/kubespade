package services

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestIsEvictablePod(t *testing.T) {
	daemon := corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{Kind: "DaemonSet"}}}}
	mirror := corev1.Pod{ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{"kubernetes.io/config.mirror": "x"}}}
	normal := corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet"}}}}
	if IsEvictablePod(daemon) {
		t.Error("daemonset pod should not be evictable")
	}
	if IsEvictablePod(mirror) {
		t.Error("mirror pod should not be evictable")
	}
	if !IsEvictablePod(normal) {
		t.Error("normal pod should be evictable")
	}
}

func TestWorkloadPodsByNode(t *testing.T) {
	pods := []corev1.Pod{
		{Spec: corev1.PodSpec{NodeName: "n1"}},
		{Spec: corev1.PodSpec{NodeName: "n1"}},
		{Spec: corev1.PodSpec{NodeName: "n2"}},
		// daemonset pod on n1 — excluded
		{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{Kind: "DaemonSet"}}}, Spec: corev1.PodSpec{NodeName: "n1"}},
		// unscheduled pod — excluded
		{Spec: corev1.PodSpec{NodeName: ""}},
	}
	got := WorkloadPodsByNode(pods)
	if got["n1"] != 2 {
		t.Errorf("n1 = %d, want 2", got["n1"])
	}
	if got["n2"] != 1 {
		t.Errorf("n2 = %d, want 1", got["n2"])
	}
	if _, ok := got[""]; ok {
		t.Error("empty node name should not appear")
	}
}

func TestParseTaintEffect(t *testing.T) {
	tests := []struct {
		in      string
		want    corev1.TaintEffect
		wantErr bool
	}{
		{"NoSchedule", corev1.TaintEffectNoSchedule, false},
		{"PreferNoSchedule", corev1.TaintEffectPreferNoSchedule, false},
		{"NoExecute", corev1.TaintEffectNoExecute, false},
		{"bogus", "", true},
		{"", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := parseTaintEffect(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error for %q", tt.in)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Errorf("parseTaintEffect(%q) = %q,%v want %q", tt.in, got, err, tt.want)
			}
		})
	}
}

func TestTaintsFromNode(t *testing.T) {
	node := &corev1.Node{Spec: corev1.NodeSpec{Taints: []corev1.Taint{
		{Key: "k1", Value: "v1", Effect: corev1.TaintEffectNoSchedule},
		{Key: "k2", Effect: corev1.TaintEffectNoExecute},
	}}}
	out := taintsFromNode(node)
	if len(out) != 2 {
		t.Fatalf("got %d taints, want 2", len(out))
	}
	if out[0] != (NodeTaint{Key: "k1", Value: "v1", Effect: "NoSchedule"}) {
		t.Errorf("out[0] = %+v", out[0])
	}
	if out[1] != (NodeTaint{Key: "k2", Value: "", Effect: "NoExecute"}) {
		t.Errorf("out[1] = %+v", out[1])
	}
}

func TestFormatTaints(t *testing.T) {
	tests := []struct {
		name   string
		taints []corev1.Taint
		want   string
	}{
		{"none", nil, ""},
		{"with value", []corev1.Taint{{Key: "k", Value: "v", Effect: corev1.TaintEffectNoSchedule}}, "k=v:NoSchedule"},
		{"no value", []corev1.Taint{{Key: "k", Effect: corev1.TaintEffectNoExecute}}, "k:NoExecute"},
		{"multiple joined by newline", []corev1.Taint{
			{Key: "a", Value: "1", Effect: corev1.TaintEffectNoSchedule},
			{Key: "b", Effect: corev1.TaintEffectPreferNoSchedule},
		}, "a=1:NoSchedule\nb:PreferNoSchedule"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatTaints(tt.taints); got != tt.want {
				t.Errorf("formatTaints = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatStorage(t *testing.T) {
	tests := []struct {
		bytes int64
		want  string
	}{
		{0, "0Mi"},
		{5 << 20, "5Mi"},
		{2 << 30, "2Gi"},
		{3 << 40, "3.0Ti"},
		{1<<40 + 1<<39, "1.5Ti"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := formatStorage(tt.bytes); got != tt.want {
				t.Errorf("formatStorage(%d) = %q, want %q", tt.bytes, got, tt.want)
			}
		})
	}
}

func TestNodeStatus(t *testing.T) {
	ready := corev1.Node{Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}}
	notReady := corev1.Node{Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionFalse}}}}
	unknown := corev1.Node{}
	if nodeStatus(ready) != "Ready" {
		t.Error("want Ready")
	}
	if nodeStatus(notReady) != "NotReady" {
		t.Error("want NotReady")
	}
	if nodeStatus(unknown) != "Unknown" {
		t.Error("want Unknown")
	}
}

func TestNodeRole(t *testing.T) {
	tests := []struct {
		name   string
		labels map[string]string
		want   string
	}{
		{"control-plane", map[string]string{"node-role.kubernetes.io/control-plane": ""}, "control-plane"},
		{"master", map[string]string{"node-role.kubernetes.io/master": ""}, "master"},
		{"worker", map[string]string{}, "worker"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := corev1.Node{ObjectMeta: metav1.ObjectMeta{Labels: tt.labels}}
			if got := nodeRole(n); got != tt.want {
				t.Errorf("nodeRole = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNodeToInfo(t *testing.T) {
	node := corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "node-1",
			Labels: map[string]string{
				"node.kubernetes.io/instance-type": "m5.large",
				"topology.kubernetes.io/zone":      "eu-central-1a",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: true,
			Taints:        []corev1.Taint{{Key: "dedicated", Value: "gpu", Effect: corev1.TaintEffectNoSchedule}},
		},
		Status: corev1.NodeStatus{
			Addresses: []corev1.NodeAddress{
				{Type: corev1.NodeHostName, Address: "host"},
				{Type: corev1.NodeInternalIP, Address: "10.0.0.5"},
			},
			Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			NodeInfo:   corev1.NodeSystemInfo{KubeletVersion: "v1.29.0", OSImage: "Amazon Linux 2"},
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("4"),
				corev1.ResourceMemory:           resource.MustParse("16Gi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("3800m"),
				corev1.ResourceMemory: resource.MustParse("15Gi"),
			},
		},
	}
	info := nodeToInfo(node, 7)
	if info.Name != "node-1" {
		t.Errorf("Name = %q", info.Name)
	}
	if info.Status != "Ready" {
		t.Errorf("Status = %q", info.Status)
	}
	if info.Role != "worker" {
		t.Errorf("Role = %q", info.Role)
	}
	if info.InternalIP != "10.0.0.5" {
		t.Errorf("InternalIP = %q", info.InternalIP)
	}
	if info.InstanceType != "m5.large" {
		t.Errorf("InstanceType = %q", info.InstanceType)
	}
	if info.Zone != "eu-central-1a" {
		t.Errorf("Zone = %q", info.Zone)
	}
	if info.Version != "v1.29.0" {
		t.Errorf("Version = %q", info.Version)
	}
	if info.CPUCap != "4" {
		t.Errorf("CPUCap = %q", info.CPUCap)
	}
	if info.MemCap != "16Gi" {
		t.Errorf("MemCap = %q", info.MemCap)
	}
	if info.CPUAllocMilli != 3800 {
		t.Errorf("CPUAllocMilli = %d", info.CPUAllocMilli)
	}
	if info.DiskAlloc != "100Gi" {
		t.Errorf("DiskAlloc = %q", info.DiskAlloc)
	}
	if !info.Unschedulable {
		t.Error("Unschedulable should be true")
	}
	if info.WorkloadPods != 7 {
		t.Errorf("WorkloadPods = %d", info.WorkloadPods)
	}
	if info.Taints != 1 {
		t.Errorf("Taints = %d", info.Taints)
	}
	if info.TaintsDetail != "dedicated=gpu:NoSchedule" {
		t.Errorf("TaintsDetail = %q", info.TaintsDetail)
	}
	if info.Lifecycle != "" {
		t.Errorf("Lifecycle = %q, want empty", info.Lifecycle)
	}
}

func TestNodeLifecycle(t *testing.T) {
	tests := []struct {
		name   string
		labels map[string]string
		want   string
	}{
		{"eks spot", map[string]string{"eks.amazonaws.com/capacityType": "SPOT"}, "Spot"},
		{"eks on-demand", map[string]string{"eks.amazonaws.com/capacityType": "ON_DEMAND"}, "On-Demand"},
		{"karpenter spot", map[string]string{"karpenter.sh/capacity-type": "spot"}, "Spot"},
		{"gke spot", map[string]string{"cloud.google.com/gke-spot": "true"}, "Spot"},
		{"gke preemptible", map[string]string{"cloud.google.com/gke-preemptible": "true"}, "Preemptible"},
		{"aks spot", map[string]string{"kubernetes.azure.com/scalesetpriority": "spot"}, "Spot"},
		{"aks regular", map[string]string{"kubernetes.azure.com/scalesetpriority": "regular"}, "On-Demand"},
		{"none", map[string]string{"node.kubernetes.io/instance-type": "m5.large"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := corev1.Node{ObjectMeta: metav1.ObjectMeta{Labels: tt.labels}}
			if got := nodeLifecycle(n); got != tt.want {
				t.Errorf("nodeLifecycle = %q, want %q", got, tt.want)
			}
		})
	}
}
