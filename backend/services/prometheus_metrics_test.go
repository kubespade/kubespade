package services

import (
	"encoding/json"
	"testing"
	"time"
)

func TestScorePrometheusService(t *testing.T) {
	cases := []struct {
		ns, name string
		labels   map[string]string
		wantMin  int
		wantZero bool
	}{
		{"monitoring", "prometheus-operated", map[string]string{"app.kubernetes.io/name": "prometheus"}, 100, false},
		{"default", "prometheus-server", nil, 80, false},
		{"kube-system", "alertmanager-main", map[string]string{"app.kubernetes.io/name": "alertmanager"}, 0, true},
		{"default", "my-app", nil, 0, true},
		{"prometheus", "kube-prometheus-stack-prometheus", map[string]string{"app": "kube-prometheus-stack-prometheus"}, 100, false},
	}
	for _, tc := range cases {
		got := scorePrometheusService(tc.ns, tc.name, tc.labels)
		if tc.wantZero {
			if got != 0 {
				t.Fatalf("%s/%s: want 0 got %d", tc.ns, tc.name, got)
			}
			continue
		}
		if got < tc.wantMin {
			t.Fatalf("%s/%s: score %d < %d", tc.ns, tc.name, got, tc.wantMin)
		}
	}
}

func TestMergePromSeries(t *testing.T) {
	cpu := map[int64]float64{100: 250.4, 110: 300}
	mem := map[int64]float64{100: 1024, 120: 2048}
	pts := mergePromSeries(cpu, mem)
	if len(pts) != 3 {
		t.Fatalf("len=%d", len(pts))
	}
	if pts[0].Timestamp != 100 || pts[0].CPUMilli != 250 || pts[0].MemBytes != 1024 {
		t.Fatalf("first=%+v", pts[0])
	}
	// Hold-forward: cpu-only timestamp keeps last mem; mem-only keeps last cpu.
	if pts[1].CPUMilli != 300 || pts[1].MemBytes != 1024 {
		t.Fatalf("second=%+v", pts[1])
	}
	if pts[2].MemBytes != 2048 || pts[2].CPUMilli != 300 {
		t.Fatalf("third=%+v", pts[2])
	}
}

func TestPrometheusStep(t *testing.T) {
	if prometheusStep(5*time.Minute) != 15*time.Second {
		t.Fatalf("short=%v", prometheusStep(5*time.Minute))
	}
	if prometheusStep(14*24*time.Hour) > 30*time.Minute {
		t.Fatalf("long too coarse: %v", prometheusStep(14*24*time.Hour))
	}
}

func TestParsePromRangeJSON(t *testing.T) {
	raw := []byte(`{
	  "status":"success",
	  "data":{"resultType":"matrix","result":[
	    {"metric":{},"values":[[1700000000,"12.5"],[1700000060,"20"]]}
	  ]}
	}`)
	var parsed promAPIResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Status != "success" || len(parsed.Data.Result) != 1 {
		t.Fatalf("%+v", parsed)
	}
	if len(parsed.Data.Result[0].Values) != 2 {
		t.Fatalf("values=%d", len(parsed.Data.Result[0].Values))
	}
}

func TestNormalizeMetricsSource(t *testing.T) {
	if NormalizeMetricsSource("") != "auto" {
		t.Fatal()
	}
	if NormalizeMetricsSource("Prometheus") != "prometheus" {
		t.Fatal()
	}
	if NormalizeMetricsSource("collector") != "collector" {
		t.Fatal()
	}
}

func TestPrometheusQueries(t *testing.T) {
	cpu, mem := prometheusQueries("pod", `web"x`, "prod")
	if cpu == "" || mem == "" {
		t.Fatal("empty")
	}
	if !containsAll(cpu, `namespace="prod"`, `pod="web\"x"`) {
		t.Fatalf("cpu=%s", cpu)
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !jsonContains(s, p) {
			return false
		}
	}
	return true
}

func jsonContains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || stringIndex(s, sub) >= 0)
}

func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
