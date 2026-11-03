package session

import "testing"

func TestDisplayLabel(t *testing.T) {
	tests := []struct {
		name        string
		displayName string
		clusterName string
		want        string
	}{
		{
			name:        "explicit display name wins",
			displayName: "My Cluster",
			clusterName: "arn:aws:eks:eu:1:cluster/prod",
			want:        "My Cluster",
		},
		{
			name:        "short form of arn cluster name",
			clusterName: "arn:aws:eks:eu:1:cluster/prod",
			want:        "prod",
		},
		{
			name:        "plain cluster name",
			clusterName: "minikube",
			want:        "minikube",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sess := ProfileSession{DisplayName: tt.displayName, ClusterName: tt.clusterName}
			if got := sess.DisplayLabel(); got != tt.want {
				t.Errorf("DisplayLabel() = %q, want %q", got, tt.want)
			}
		})
	}
}
