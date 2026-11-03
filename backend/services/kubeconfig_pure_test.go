package services

import (
	"os"
	"path/filepath"
	"testing"

	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestShortClusterDisplayName(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"eks arn", "arn:aws:eks:eu-central-1:123456789012:cluster/my-prod", "my-prod"},
		{"eks arn nested slash in name", "arn:aws:eks:eu-central-1:123:cluster/team/prod", "team/prod"},
		{"generic arn last slash", "arn:aws:iam::123:role/some-role", "some-role"},
		{"plain name unchanged", "minikube", "minikube"},
		{"path-like non-arn unchanged", "gke_project_zone_cluster", "gke_project_zone_cluster"},
		{"arn no slash returns whole", "arn:aws:something", "arn:aws:something"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShortClusterDisplayName(tt.in); got != tt.want {
				t.Errorf("ShortClusterDisplayName(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestProfileDisplayName(t *testing.T) {
	tests := []struct {
		name string
		meta ProfileMeta
		want string
	}{
		{
			name: "cluster arn wins",
			meta: ProfileMeta{Name: "id1", Type: "aws", ClusterName: "arn:aws:eks:eu:1:cluster/prod", Region: "eu"},
			want: "prod",
		},
		{
			name: "aws fallback region",
			meta: ProfileMeta{Name: "id1", Type: "aws", Region: "eu-central-1"},
			want: "EKS (eu-central-1)",
		},
		{
			name: "gcp fallback project",
			meta: ProfileMeta{Name: "id1", Type: "gcp", ProjectID: "my-proj"},
			want: "GKE (my-proj)",
		},
		{
			name: "azure fallback",
			meta: ProfileMeta{Name: "id1", Type: "azure"},
			want: "AKS",
		},
		{
			name: "no cluster no fallback → name",
			meta: ProfileMeta{Name: "opaque-id", Type: "kubeconfig"},
			want: "opaque-id",
		},
		{
			name: "aws without region → name",
			meta: ProfileMeta{Name: "opaque-id", Type: "aws"},
			want: "opaque-id",
		},
		{
			name: "user alias wins over cluster name",
			meta: ProfileMeta{Name: "id1", Type: "aws", ClusterName: "arn:aws:eks:eu:1:cluster/prod", DisplayName: "prod-eu"},
			want: "prod-eu",
		},
		{
			name: "blank alias falls through",
			meta: ProfileMeta{Name: "id1", Type: "kubeconfig", ClusterName: "minikube", DisplayName: "  "},
			want: "minikube",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ProfileDisplayName(tt.meta); got != tt.want {
				t.Errorf("ProfileDisplayName(%+v) = %q, want %q", tt.meta, got, tt.want)
			}
		})
	}
}

func TestResolveKubeconfigDisplayName(t *testing.T) {
	t.Run("nil config uses context name short form", func(t *testing.T) {
		if got := ResolveKubeconfigDisplayName(nil, "arn:aws:eks:eu:1:cluster/ctx"); got != "ctx" {
			t.Errorf("got %q, want %q", got, "ctx")
		}
	})

	t.Run("missing context falls back to short of name", func(t *testing.T) {
		cfg := &clientcmdapi.Config{Contexts: map[string]*clientcmdapi.Context{}}
		if got := ResolveKubeconfigDisplayName(cfg, "plain"); got != "plain" {
			t.Errorf("got %q, want %q", got, "plain")
		}
	})

	t.Run("exec --cluster-name arg wins", func(t *testing.T) {
		cfg := &clientcmdapi.Config{
			Contexts:  map[string]*clientcmdapi.Context{"ctx": {Cluster: "cl", AuthInfo: "au"}},
			Clusters:  map[string]*clientcmdapi.Cluster{"cl": {Server: "https://x"}},
			AuthInfos: map[string]*clientcmdapi.AuthInfo{"au": {Exec: &clientcmdapi.ExecConfig{Args: []string{"eks", "get-token", "--cluster-name", "the-eks"}}}},
		}
		if got := ResolveKubeconfigDisplayName(cfg, "ctx"); got != "the-eks" {
			t.Errorf("got %q, want %q", got, "the-eks")
		}
	})

	t.Run("cluster short form when arn", func(t *testing.T) {
		cfg := &clientcmdapi.Config{
			Contexts:  map[string]*clientcmdapi.Context{"ctx": {Cluster: "arn:aws:eks:eu:1:cluster/short", AuthInfo: "au"}},
			Clusters:  map[string]*clientcmdapi.Cluster{"arn:aws:eks:eu:1:cluster/short": {Server: "https://x"}},
			AuthInfos: map[string]*clientcmdapi.AuthInfo{"au": {}},
		}
		if got := ResolveKubeconfigDisplayName(cfg, "ctx"); got != "short" {
			t.Errorf("got %q, want %q", got, "short")
		}
	})

	t.Run("falls back to context name when cluster is plain", func(t *testing.T) {
		cfg := &clientcmdapi.Config{
			Contexts:  map[string]*clientcmdapi.Context{"the-context": {Cluster: "plaincluster", AuthInfo: "au"}},
			Clusters:  map[string]*clientcmdapi.Cluster{"plaincluster": {Server: "https://x"}},
			AuthInfos: map[string]*clientcmdapi.AuthInfo{"au": {}},
		}
		if got := ResolveKubeconfigDisplayName(cfg, "the-context"); got != "the-context" {
			t.Errorf("got %q, want %q", got, "the-context")
		}
	})
}

func TestExpandHomePath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skipf("no home dir: %v", err)
	}
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"tilde only", "~", home},
		{"tilde slash", "~/.kube/config", filepath.Join(home, ".kube/config")},
		{"absolute unchanged", "/etc/passwd", "/etc/passwd"},
		{"relative unchanged", "some/rel/path", "some/rel/path"},
		{"tilde-user not expanded", "~other/x", "~other/x"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExpandHomePath(tt.in); got != tt.want {
				t.Errorf("ExpandHomePath(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
