package services

import (
	"context"
	"testing"
	"time"
)

func TestHistorySourcePrefLegacyCollector(t *testing.T) {
	if got := historySourcePref(MetricsSourcePrefs{Source: "collector"}); got != "auto" {
		t.Fatalf("collector pref should resolve as auto, got %q", got)
	}
	if got := historySourcePref(MetricsSourcePrefs{Source: "prometheus"}); got != "prometheus" {
		t.Fatalf("prometheus pref unchanged, got %q", got)
	}
	if got := historySourcePref(MetricsSourcePrefs{Source: "auto"}); got != "auto" {
		t.Fatalf("auto unchanged, got %q", got)
	}
	if got := historySourcePref(MetricsSourcePrefs{Source: ""}); got != "auto" {
		t.Fatalf("empty → auto, got %q", got)
	}
}

func TestLocalHistorySource(t *testing.T) {
	empty := localHistory(nil)
	if empty.Source != "none" || len(empty.Points) != 0 {
		t.Fatalf("nil local → none, got %+v", empty)
	}
	pts := []MetricPoint{{Timestamp: time.Now().UnixMilli(), CPUMilli: 1, MemBytes: 2}}
	got := localHistory(pts)
	if got.Source != "local" || len(got.Points) != 1 {
		t.Fatalf("non-empty local → local, got %+v", got)
	}
}

func TestMergeHistoryCapSmallRemote(t *testing.T) {
	remote := []MetricPoint{{Timestamp: 1, CPUMilli: 10}}
	local := []MetricPoint{{Timestamp: 2, CPUMilli: 20}}
	merged := mergeHistoryCap(remote, local)
	if len(merged) < 1 {
		t.Fatal("expected merged points")
	}
	// Cap for small remote is 720 — both points should fit.
	if len(merged) > 720 {
		t.Fatalf("len = %d", len(merged))
	}
}

func TestResolveMetricsHistoryNilConfigFallsBackToLocal(t *testing.T) {
	ctx := context.Background()
	local := []MetricPoint{{Timestamp: 100, CPUMilli: 5, MemBytes: 9}}

	cases := []struct {
		name   string
		prefs  MetricsSourcePrefs
		want   string
		hasPts bool
	}{
		{"auto with local", MetricsSourcePrefs{Source: "auto"}, "local", true},
		{"prometheus forced", MetricsSourcePrefs{Source: "prometheus"}, "local", true},
		{"legacy collector→auto", MetricsSourcePrefs{Source: "collector"}, "local", true},
		{"empty local", MetricsSourcePrefs{Source: "auto"}, "none", false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			in := local
			if !tt.hasPts {
				in = nil
			}
			got := ResolveMetricsHistory(ctx, "prof", nil, tt.prefs, "cluster", "", "", in)
			if got.Source != tt.want {
				t.Fatalf("Source = %q, want %q", got.Source, tt.want)
			}
			if tt.hasPts && len(got.Points) == 0 {
				t.Fatal("expected points")
			}
			if !tt.hasPts && len(got.Points) != 0 {
				t.Fatalf("expected no points, got %d", len(got.Points))
			}
		})
	}
}

func TestResolveMetricsHistoryHonorsCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// nil cfg never dials the cluster; should still return quickly with local.
	got := ResolveMetricsHistory(ctx, "p", nil, MetricsSourcePrefs{Source: "auto"}, "node", "n1", "", nil)
	if got.Source != "none" {
		t.Fatalf("Source = %q", got.Source)
	}
}
