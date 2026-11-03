package services

import (
	"encoding/base64"
	"testing"
)

func TestParseAKSUserKubeconfig_clientCert(t *testing.T) {
	ca := base64.StdEncoding.EncodeToString([]byte("CA-PEM"))
	cert := base64.StdEncoding.EncodeToString([]byte("CERT-PEM"))
	key := base64.StdEncoding.EncodeToString([]byte("KEY-PEM"))
	yaml := []byte(`apiVersion: v1
kind: Config
clusters:
- name: aks
  cluster:
    server: https://example.hcp.swedencentral.azmk8s.io:443
    certificate-authority-data: ` + ca + `
contexts:
- name: aks-ctx
  context:
    cluster: aks
    user: clusterUser
current-context: aks-ctx
users:
- name: clusterUser
  user:
    client-certificate-data: ` + cert + `
    client-key-data: ` + key + `
`)
	got, err := parseAKSUserKubeconfig(yaml)
	if err != nil {
		t.Fatal(err)
	}
	if got.server != "https://example.hcp.swedencentral.azmk8s.io:443" {
		t.Fatalf("server: %s", got.server)
	}
	if string(got.caData) != "CA-PEM" {
		t.Fatalf("ca: %q", got.caData)
	}
	if string(got.certData) != "CERT-PEM" || string(got.keyData) != "KEY-PEM" {
		t.Fatalf("cert/key: %q %q", got.certData, got.keyData)
	}
	if !got.staticAuth {
		t.Fatal("expected staticAuth for client cert kubeconfig")
	}
}

func TestParseAKSUserKubeconfig_token(t *testing.T) {
	ca := base64.StdEncoding.EncodeToString([]byte("CA-PEM"))
	yaml := []byte(`apiVersion: v1
kind: Config
clusters:
- name: aks
  cluster:
    server: https://aks.example
    certificate-authority-data: ` + ca + `
contexts:
- name: aks-ctx
  context:
    cluster: aks
    user: clusterUser
current-context: aks-ctx
users:
- name: clusterUser
  user:
    token: kubeconfig-token
`)
	got, err := parseAKSUserKubeconfig(yaml)
	if err != nil {
		t.Fatal(err)
	}
	if got.token != "kubeconfig-token" || !got.staticAuth {
		t.Fatalf("token=%q static=%v", got.token, got.staticAuth)
	}
}

func TestParseAKSUserKubeconfig_execNotStatic(t *testing.T) {
	ca := base64.StdEncoding.EncodeToString([]byte("CA-PEM"))
	yaml := []byte(`apiVersion: v1
kind: Config
clusters:
- name: aks
  cluster:
    server: https://aks.example
    certificate-authority-data: ` + ca + `
contexts:
- name: aks-ctx
  context:
    cluster: aks
    user: clusterUser
current-context: aks-ctx
users:
- name: clusterUser
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubelogin
      args: ["get-token"]
`)
	got, err := parseAKSUserKubeconfig(yaml)
	if err != nil {
		t.Fatal(err)
	}
	if got.staticAuth || got.token != "" || len(got.certData) != 0 {
		t.Fatalf("exec kubeconfig should not be static: %+v", got)
	}
	if got.server != "https://aks.example" {
		t.Fatalf("server: %s", got.server)
	}
}

func TestExtractResourceGroup_armCasing(t *testing.T) {
	id := "/subscriptions/sub/resourcegroups/kubespade-test-rg/providers/Microsoft.ContainerService/managedClusters/kubespade-test-aks"
	if got := extractResourceGroup(id); got != "kubespade-test-rg" {
		t.Fatalf("lowercase segment: %q", got)
	}
	id2 := "/subscriptions/sub/resourceGroups/KubeSpade-Test-RG/providers/Microsoft.ContainerService/managedClusters/aks"
	if got := extractResourceGroup(id2); got != "KubeSpade-Test-RG" {
		t.Fatalf("preserve RG casing: %q", got)
	}
}
