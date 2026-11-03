package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSanitizeAIContext(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"prod-eks", "prod-eks"},
		{"My Cluster!", "My-Cluster"},
		{"  ", "cluster"},
		{"a/b\\c", "a-b-c"},
	}
	for _, tc := range cases {
		if got := SanitizeAIContext(tc.in); got != tc.want {
			t.Errorf("SanitizeAIContext(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestBuildClaudeMDEmpty(t *testing.T) {
	md := buildIdentityMD(nil)
	if !strings.Contains(md, "No clusters are connected") {
		t.Fatalf("expected zero-cluster guidance, got:\n%s", md)
	}
}

func TestBuildClaudeMDWithClusters(t *testing.T) {
	md := buildIdentityMD([]AIClusterEntry{{
		Context: "prod",
		Profile: "aws-prod",
		Label:   "prod",
	}})
	if !strings.Contains(md, "`prod`") || !strings.Contains(md, "cluster tools") {
		t.Fatalf("unexpected identity md:\n%s", md)
	}
	if !strings.Contains(md, "Never run `kubectl`") {
		t.Fatalf("expected no-kubectl guidance:\n%s", md)
	}
	if !strings.Contains(md, "items:") {
		t.Fatalf("expected batch-delete guidance:\n%s", md)
	}
}

func TestWriteAIWorkspaceEmpty(t *testing.T) {
	prev := os.Getenv("K8S_CLIENT_DATA")
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)
	defer os.Setenv("K8S_CLIENT_DATA", prev)

	ws, err := WriteAIWorkspace(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ws.ClusterCount != 0 {
		t.Fatalf("clusterCount=%d", ws.ClusterCount)
	}
	if _, err := os.Stat(ws.Kubeconfig); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(ws.ShellKubeconfig); err != nil {
		t.Fatal(err)
	}
	md, err := os.ReadFile(filepath.Join(ws.Path, "CLAUDE.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(md), "No clusters are connected") {
		t.Fatalf("CLAUDE.md: %s", md)
	}
	// Live secrets must not live in the AI cwd.
	if filepath.Dir(ws.Kubeconfig) == ws.Path {
		t.Fatalf("live kubeconfig should be outside workspace, got %s", ws.Kubeconfig)
	}
	if err := ClearAIWorkspace(); err != nil {
		t.Fatal(err)
	}
}
