package services

import (
	"errors"
	"testing"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestIsMetricsUnavailable(t *testing.T) {
	notFound := k8serrors.NewNotFound(schema.GroupResource{Group: "metrics.k8s.io", Resource: "pods"}, "x")
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"typed NotFound", notFound, true},
		{"text 404", errors.New("the server returned 404 for this request"), true},
		{"text not found", errors.New("resource not found"), true},
		{"text server could not find", errors.New("the server could not find the requested resource"), true},
		{"text no matches for kind", errors.New("no matches for kind PodMetrics"), true},
		{"unrelated error", errors.New("connection refused"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsMetricsUnavailable(tt.err); got != tt.want {
				t.Errorf("IsMetricsUnavailable(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestFormatCPU(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", "—"},
		{"500m", "500m"},
		{"1000m", "1.00c"},
		{"1", "1.00c"},
		{"2", "2.00c"},
		{"1500m", "1.50c"},
		{"250m", "250m"},
		{"0", "0m"},
		{"not-a-quantity", "not-a-quantity"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := formatCPU(tt.in); got != tt.want {
				t.Errorf("formatCPU(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestFormatMemory(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", "—"},
		{"512", "512B"},
		{"1Ki", "1Ki"},
		{"2Ki", "2Ki"},
		{"1Mi", "1Mi"},
		{"512Mi", "512Mi"},
		{"1Gi", "1.0Gi"},
		{"2Gi", "2.0Gi"},
		{"1536Mi", "1.5Gi"},
		{"bogus", "bogus"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := formatMemory(tt.in); got != tt.want {
				t.Errorf("formatMemory(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
