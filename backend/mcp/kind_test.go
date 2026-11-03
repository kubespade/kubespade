package mcp

import (
	"strings"
	"testing"
)

func TestNormalizeResource(t *testing.T) {
	cases := map[string]string{
		"pods":   "pods",
		"po":     "pods",
		"EV":     "events",
		"event":  "events",
		"deploy": "deployments",
	}
	for in, want := range cases {
		if got := normalizeResource(in); got != want {
			t.Errorf("normalizeResource(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWantsWarningOnly(t *testing.T) {
	if !wantsWarningOnly(map[string]any{"fieldSelector": "type=Warning"}) {
		t.Fatal("fieldSelector type=Warning")
	}
	if !wantsWarningOnly(map[string]any{"extraArgs": []any{"--field-selector=type=Warning"}}) {
		t.Fatal("extraArgs field-selector")
	}
	if wantsWarningOnly(map[string]any{"resource": "pods"}) {
		t.Fatal("pods should not filter warnings")
	}
}

func TestParseDeleteTargetsBatch(t *testing.T) {
	got, errMsg := parseDeleteTargets(map[string]any{
		"items": []any{
			map[string]any{"resource": "deploy", "name": "web", "namespace": "default"},
			map[string]any{"resource": "svc", "name": "web", "namespace": "default"},
		},
	})
	if errMsg != "" {
		t.Fatal(errMsg)
	}
	if len(got) != 2 || got[0].Resource != "deployments" || got[1].Resource != "services" {
		t.Fatalf("got %+v", got)
	}
	detail := formatDeleteDetail("prod", got)
	if !strings.Contains(detail, "Delete 2 resources") || !strings.Contains(detail, "deployments/web") {
		t.Fatalf("detail=%q", detail)
	}
}

func TestParseDeleteTargetsSingle(t *testing.T) {
	got, errMsg := parseDeleteTargets(map[string]any{"resource": "pods", "name": "x", "namespace": "ns"})
	if errMsg != "" || len(got) != 1 || got[0].Name != "x" {
		t.Fatalf("got %+v err=%q", got, errMsg)
	}
}

func TestParseDeleteTargetsRejectsEmpty(t *testing.T) {
	if _, errMsg := parseDeleteTargets(map[string]any{}); errMsg == "" {
		t.Fatal("expected error")
	}
}
