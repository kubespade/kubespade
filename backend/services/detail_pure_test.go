package services

import "testing"

func TestEventFieldSelector(t *testing.T) {
	tests := []struct {
		name string
		obj  string
		kind string
		want string
	}{
		{"name only", "my-pod", "", "involvedObject.name=my-pod"},
		{"name and kind", "my-pod", "Pod", "involvedObject.name=my-pod,involvedObject.kind=Pod"},
		{"deployment", "web", "Deployment", "involvedObject.name=web,involvedObject.kind=Deployment"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := eventFieldSelector(tt.obj, tt.kind); got != tt.want {
				t.Errorf("eventFieldSelector(%q,%q) = %q, want %q", tt.obj, tt.kind, got, tt.want)
			}
		})
	}
}
