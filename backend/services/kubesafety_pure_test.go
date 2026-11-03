package services

import (
	"sort"
	"strings"
	"testing"
)

func TestBuildPodExecCommand(t *testing.T) {
	bash := BuildPodExecCommand("/bin/bash")
	if len(bash) != 3 || bash[0] != "/bin/sh" || bash[1] != "-c" {
		t.Fatalf("bash argv: %#v", bash)
	}
	if !strings.Contains(bash[2], "7777;cwd=") || !strings.Contains(bash[2], "--rcfile") {
		t.Fatalf("bash script missing cwd rcfile hook: %s", bash[2])
	}
	ash := BuildPodExecCommand("/bin/ash")
	if !strings.Contains(ash[2], "/bin/ash") || !strings.Contains(ash[2], "7777;cwd=") {
		t.Fatalf("ash script: %s", ash[2])
	}
	sh := BuildPodExecCommand("/bin/sh")
	if !strings.Contains(sh[2], "exec /bin/sh") {
		t.Fatalf("sh script: %s", sh[2])
	}
}

func TestNormalizeExecShell(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "/bin/sh", false},
		{"  ", "/bin/sh", false},
		{"bash", "/bin/bash", false},
		{"sh", "/bin/sh", false},
		{"ash", "/bin/ash", false},
		{"/bin/bash", "/bin/bash", false},
		{"/bin/sh", "/bin/sh", false},
		{"/bin/ash", "/bin/ash", false},
		{"  bash  ", "/bin/bash", false},
		{"/bin/zsh", "", true},
		{"rm", "", true},
		{"/usr/bin/python", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := NormalizeExecShell(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error for %q", tt.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("NormalizeExecShell(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

const execKubeconfig = `apiVersion: v1
kind: Config
current-context: ctx-a
clusters:
- name: cluster-a
  cluster:
    server: https://a.example.com
    insecure-skip-tls-verify: true
- name: cluster-b
  cluster:
    server: https://b.example.com
contexts:
- name: ctx-a
  context:
    cluster: cluster-a
    user: user-a
- name: ctx-b
  context:
    cluster: cluster-b
    user: user-b
users:
- name: user-a
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args: ["eks", "get-token"]
- name: user-b
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubelogin
      args: ["get-token"]
`

const staticKubeconfig = `apiVersion: v1
kind: Config
current-context: only
clusters:
- name: c
  cluster:
    server: https://c.example.com
contexts:
- name: only
  context:
    cluster: c
    user: u
users:
- name: u
  user:
    token: abc
`

func TestKubeconfigExecCommands(t *testing.T) {
	t.Run("distinct exec commands", func(t *testing.T) {
		cmds, err := KubeconfigExecCommands(execKubeconfig)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		sort.Strings(cmds)
		if len(cmds) != 2 || cmds[0] != "aws" || cmds[1] != "kubelogin" {
			t.Errorf("got %v, want [aws kubelogin]", cmds)
		}
	})
	t.Run("no exec plugins", func(t *testing.T) {
		cmds, err := KubeconfigExecCommands(staticKubeconfig)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if len(cmds) != 0 {
			t.Errorf("got %v, want empty", cmds)
		}
	})
	t.Run("invalid yaml errors", func(t *testing.T) {
		if _, err := KubeconfigExecCommands("\tnot yaml:::"); err == nil {
			t.Error("expected error for invalid kubeconfig")
		}
	})
}

func TestKubeconfigInsecureTLS(t *testing.T) {
	t.Run("insecure current context", func(t *testing.T) {
		insecure, server, err := KubeconfigInsecureTLS(execKubeconfig, "")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if !insecure || server != "https://a.example.com" {
			t.Errorf("got insecure=%v server=%q", insecure, server)
		}
	})
	t.Run("secure named context", func(t *testing.T) {
		insecure, server, err := KubeconfigInsecureTLS(execKubeconfig, "ctx-b")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if insecure || server != "https://b.example.com" {
			t.Errorf("got insecure=%v server=%q", insecure, server)
		}
	})
	t.Run("unknown context errors", func(t *testing.T) {
		if _, _, err := KubeconfigInsecureTLS(execKubeconfig, "does-not-exist"); err == nil {
			t.Error("expected error for unknown context")
		}
	})
}
