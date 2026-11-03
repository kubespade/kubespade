package services

import "testing"

func TestKubeconfigToRestConfigWithContext_staleCurrentContext(t *testing.T) {
	yaml := `apiVersion: v1
kind: Config
current-context: kubespade-test-aks
clusters:
- name: keep
  cluster:
    server: https://keep.example
contexts:
- name: main-dev-eks-cluster
  context:
    cluster: keep
    user: keep-user
users:
- name: keep-user
  user:
    token: fake-token
`
	cfg, err := KubeconfigToRestConfigWithContext(yaml, "main-dev-eks-cluster")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "https://keep.example" {
		t.Fatalf("host: %s", cfg.Host)
	}
}

func TestKubeconfigToRestConfigWithContext_emptyNameUsesRemaining(t *testing.T) {
	yaml := `apiVersion: v1
kind: Config
current-context: gone
clusters:
- name: keep
  cluster:
    server: https://keep.example
contexts:
- name: keep-ctx
  context:
    cluster: keep
    user: keep-user
users:
- name: keep-user
  user:
    token: fake-token
`
	cfg, err := KubeconfigToRestConfigWithContext(yaml, "")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "https://keep.example" {
		t.Fatalf("host: %s", cfg.Host)
	}
}
