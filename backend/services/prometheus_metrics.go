package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	rest "k8s.io/client-go/rest"
)

var (
	promDiscoverMu    sync.Mutex
	promDiscoverCache = map[string]promDiscoverCacheEntry{}
)

type promDiscoverCacheEntry struct {
	cands   []PrometheusRef
	expires time.Time
}

func discoverPrometheusCached(ctx context.Context, k8sCfg *rest.Config, withHealth bool) ([]PrometheusRef, error) {
	if k8sCfg == nil {
		return nil, fmt.Errorf("no k8s config")
	}
	key := k8sCfg.Host
	promDiscoverMu.Lock()
	if e, ok := promDiscoverCache[key]; ok && time.Now().Before(e.expires) {
		cands := append([]PrometheusRef(nil), e.cands...)
		promDiscoverMu.Unlock()
		return cands, nil
	}
	promDiscoverMu.Unlock()

	cands, err := DiscoverPrometheus(ctx, k8sCfg, withHealth)
	if err != nil {
		return nil, err
	}
	promDiscoverMu.Lock()
	promDiscoverCache[key] = promDiscoverCacheEntry{cands: cands, expires: time.Now().Add(10 * time.Minute)}
	promDiscoverMu.Unlock()
	return cands, nil
}

// PrometheusRef points at an in-cluster Prometheus Service (proxy path).
type PrometheusRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Port      string `json:"port"` // port name or number as string
	Score     int    `json:"score,omitempty"`
	Healthy   bool   `json:"healthy,omitempty"`
}

// MetricsSourcePrefs is stored on ProfileMeta (local app config).
type MetricsSourcePrefs struct {
	// Source: auto | prometheus | collector (empty = auto)
	Source string `json:"source,omitempty"`
	// Manual in-cluster Service selection (overrides discovery when set).
	PrometheusNamespace string `json:"prometheusNamespace,omitempty"`
	PrometheusService   string `json:"prometheusService,omitempty"`
	PrometheusPort      string `json:"prometheusPort,omitempty"`
	// External URL (optional advanced). Used when set and source is prometheus/auto with no cluster ref.
	PrometheusURL    string `json:"prometheusURL,omitempty"`
	PrometheusBearer string `json:"prometheusBearer,omitempty"`
}

func NormalizeMetricsSource(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "prometheus", "collector":
		return strings.ToLower(strings.TrimSpace(s))
	default:
		return "auto"
	}
}

func PrefsFromProfile(p ProfileMeta) MetricsSourcePrefs {
	return MetricsSourcePrefs{
		Source:              NormalizeMetricsSource(p.MetricsSource),
		PrometheusNamespace: strings.TrimSpace(p.PrometheusNamespace),
		PrometheusService:   strings.TrimSpace(p.PrometheusService),
		PrometheusPort:      strings.TrimSpace(p.PrometheusPort),
		PrometheusURL:       strings.TrimSpace(p.PrometheusURL),
		PrometheusBearer:    strings.TrimSpace(p.PrometheusBearer),
	}
}

func ApplyMetricsPrefs(p *ProfileMeta, prefs MetricsSourcePrefs) {
	p.MetricsSource = NormalizeMetricsSource(prefs.Source)
	if p.MetricsSource == "auto" {
		p.MetricsSource = "" // omit empty in JSON
	}
	p.PrometheusNamespace = strings.TrimSpace(prefs.PrometheusNamespace)
	p.PrometheusService = strings.TrimSpace(prefs.PrometheusService)
	p.PrometheusPort = strings.TrimSpace(prefs.PrometheusPort)
	p.PrometheusURL = strings.TrimSpace(prefs.PrometheusURL)
	p.PrometheusBearer = strings.TrimSpace(prefs.PrometheusBearer)
}

// DiscoverPrometheus lists candidate Prometheus Services, ranked and optionally health-checked.
func DiscoverPrometheus(ctx context.Context, k8sCfg *rest.Config, healthCheck bool) ([]PrometheusRef, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	svcs, err := client.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	var out []PrometheusRef
	for _, svc := range svcs.Items {
		port := pickPrometheusPort(svc.Spec.Ports)
		if port == "" {
			continue
		}
		score := scorePrometheusService(svc.Namespace, svc.Name, svc.Labels)
		if score <= 0 {
			continue
		}
		ref := PrometheusRef{
			Namespace: svc.Namespace,
			Name:      svc.Name,
			Port:      port,
			Score:     score,
		}
		out = append(out, ref)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	// Cap list for UI; health-check top few.
	const maxList = 25
	if len(out) > maxList {
		out = out[:maxList]
	}
	if healthCheck {
		for i := range out {
			if i >= 8 {
				break
			}
			out[i].Healthy = prometheusHealthy(ctx, k8sCfg, out[i], "")
		}
	}
	return out, nil
}

func pickPrometheusPort(ports []corev1.ServicePort) string {
	// Prefer named web/http, then 9090, then first TCP.
	var firstTCP string
	for _, p := range ports {
		name := strings.ToLower(p.Name)
		portStr := strconv.Itoa(int(p.Port))
		if name == "web" || name == "http" || name == "ui" {
			if p.Name != "" {
				return p.Name
			}
			return portStr
		}
		if p.Port == 9090 {
			if p.Name != "" {
				return p.Name
			}
			return "9090"
		}
		if firstTCP == "" && (p.Protocol == "" || p.Protocol == corev1.ProtocolTCP) {
			if p.Name != "" {
				firstTCP = p.Name
			} else {
				firstTCP = portStr
			}
		}
	}
	return firstTCP
}

func scorePrometheusService(ns, name string, labels map[string]string) int {
	nsl := strings.ToLower(ns)
	nl := strings.ToLower(name)
	score := 0

	if strings.Contains(nl, "alertmanager") || strings.Contains(nl, "pushgateway") ||
		strings.Contains(nl, "operator") && !strings.Contains(nl, "prometheus") {
		return 0
	}

	appName := strings.ToLower(labels["app.kubernetes.io/name"])
	app := strings.ToLower(labels["app"])
	component := strings.ToLower(labels["app.kubernetes.io/component"])

	if appName == "prometheus" || app == "prometheus" || app == "kube-prometheus-stack-prometheus" {
		score += 100
	}
	if component == "server" || component == "prometheus" {
		score += 20
	}
	if strings.HasSuffix(nl, "-prometheus") || nl == "prometheus" || nl == "prometheus-server" ||
		nl == "prometheus-operated" || strings.Contains(nl, "prometheus-server") {
		score += 80
	} else if strings.Contains(nl, "prometheus") {
		score += 40
	} else {
		return 0
	}

	switch nsl {
	case "monitoring", "prometheus", "observability", "metrics":
		score += 30
	}

	return score
}

func prometheusHealthy(ctx context.Context, k8sCfg *rest.Config, ref PrometheusRef, externalURL string) bool {
	body, err := prometheusGET(ctx, k8sCfg, ref, externalURL, "", "/api/v1/status/buildinfo", nil)
	if err == nil && len(body) > 0 && strings.Contains(string(body), `"status"`) {
		return true
	}
	q := url.Values{"query": {"up"}}
	body, err = prometheusGET(ctx, k8sCfg, ref, externalURL, "", "/api/v1/query", q)
	return err == nil && len(body) > 0 && strings.Contains(string(body), `"status":"success"`)
}

func prometheusGET(
	ctx context.Context,
	k8sCfg *rest.Config,
	ref PrometheusRef,
	externalURL, bearer, path string,
	params url.Values,
) ([]byte, error) {
	externalURL = strings.TrimRight(strings.TrimSpace(externalURL), "/")
	if externalURL != "" {
		u, err := url.Parse(externalURL + path)
		if err != nil {
			return nil, err
		}
		if params != nil {
			u.RawQuery = params.Encode()
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		if err != nil {
			return nil, err
		}
		if resp.StatusCode >= 300 {
			return nil, fmt.Errorf("prometheus HTTP %d: %s", resp.StatusCode, truncateErr(string(b)))
		}
		return b, nil
	}
	if ref.Namespace == "" || ref.Name == "" || ref.Port == "" {
		return nil, fmt.Errorf("prometheus service ref incomplete")
	}
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	paramMap := map[string]string{}
	for k, vs := range params {
		if len(vs) > 0 {
			paramMap[k] = vs[0]
		}
	}
	return client.CoreV1().Services(ref.Namespace).ProxyGet(
		"http", ref.Name, ref.Port, path, paramMap,
	).DoRaw(ctx)
}

func truncateErr(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}

type promAPIResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Values [][]json.RawMessage `json:"values"`
			Value  []json.RawMessage   `json:"value"`
		} `json:"result"`
	} `json:"data"`
	Error string `json:"error"`
}

// QueryPrometheusHistory runs paired CPU/mem range queries and merges into MetricPoints.
// kind: cluster | node | pod
//
// Uses a fine recent band (so 5m–6h charts are dense after restart) plus a coarser
// long band for multi-day windows — a single 14d query at ~1h step left short
// ranges empty except for the live tip.
func QueryPrometheusHistory(
	ctx context.Context,
	k8sCfg *rest.Config,
	ref PrometheusRef,
	externalURL, bearer string,
	kind, id, namespace string,
	since time.Time,
	until time.Time,
) ([]MetricPoint, error) {
	if until.IsZero() {
		until = time.Now()
	}
	if since.IsZero() || !since.Before(until) {
		since = until.Add(-24 * time.Hour)
	}
	cpuQ, memQ := prometheusQueries(kind, id, namespace)
	if cpuQ == "" {
		return nil, fmt.Errorf("unsupported kind %q", kind)
	}

	cpuSeries := map[int64]float64{}
	memSeries := map[int64]float64{}
	mergeBand := func(from, to time.Time, step time.Duration) error {
		if !from.Before(to) {
			return nil
		}
		cpu, err := queryRangeValues(ctx, k8sCfg, ref, externalURL, bearer, cpuQ, from, to, step)
		if err != nil {
			return err
		}
		mem, err := queryRangeValues(ctx, k8sCfg, ref, externalURL, bearer, memQ, from, to, step)
		if err != nil {
			return err
		}
		for t, v := range cpu {
			cpuSeries[t] = v
		}
		for t, v := range mem {
			memSeries[t] = v
		}
		return nil
	}

	// Recent high-res band first (overwrites overlapping coarse samples later).
	recentFrom := until.Add(-6 * time.Hour)
	if recentFrom.Before(since) {
		recentFrom = since
	}
	if err := mergeBand(recentFrom, until, 15*time.Second); err != nil {
		return nil, err
	}
	if since.Before(recentFrom) {
		if err := mergeBand(since, recentFrom, prometheusStep(recentFrom.Sub(since))); err != nil {
			return nil, err
		}
	}
	return mergePromSeries(cpuSeries, memSeries), nil
}

func prometheusStep(dur time.Duration) time.Duration {
	// Aim for ~800–2000 points; keep multi-day steps usable for 6h–30d charts.
	sec := dur.Seconds() / 1500
	switch {
	case sec <= 15:
		return 15 * time.Second
	case sec <= 30:
		return 30 * time.Second
	case sec <= 60:
		return time.Minute
	case sec <= 120:
		return 2 * time.Minute
	case sec <= 300:
		return 5 * time.Minute
	case sec <= 900:
		return 15 * time.Minute
	default:
		return 30 * time.Minute
	}
}

func prometheusQueries(kind, id, namespace string) (cpu, mem string) {
	esc := func(s string) string {
		return strings.ReplaceAll(s, `"`, `\"`)
	}
	switch kind {
	case "cluster":
		cpu = `sum(rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[5m])) * 1000`
		mem = `sum(container_memory_working_set_bytes{container!="",container!="POD"})`
	case "node":
		n := esc(id)
		// Prefer cadvisor node label (kubelet); fall back to node_exporter instance prefix match is done via OR in recording-friendly forms.
		cpu = fmt.Sprintf(
			`sum(rate(container_cpu_usage_seconds_total{node="%s",container!="",container!="POD"}[5m])) * 1000`, n)
		mem = fmt.Sprintf(
			`sum(container_memory_working_set_bytes{node="%s",container!="",container!="POD"})`, n)
	case "pod":
		n := esc(id)
		ns := esc(namespace)
		cpu = fmt.Sprintf(
			`sum(rate(container_cpu_usage_seconds_total{namespace="%s",pod="%s",container!="",container!="POD"}[5m])) * 1000`, ns, n)
		mem = fmt.Sprintf(
			`sum(container_memory_working_set_bytes{namespace="%s",pod="%s",container!="",container!="POD"})`, ns, n)
	}
	return cpu, mem
}

func queryRangeValues(
	ctx context.Context,
	k8sCfg *rest.Config,
	ref PrometheusRef,
	externalURL, bearer, query string,
	since, until time.Time,
	step time.Duration,
) (map[int64]float64, error) {
	params := url.Values{
		"query": {query},
		"start": {fmt.Sprintf("%.3f", float64(since.Unix())+float64(since.Nanosecond())/1e9)},
		"end":   {fmt.Sprintf("%.3f", float64(until.Unix())+float64(until.Nanosecond())/1e9)},
		"step":  {fmt.Sprintf("%.0fs", step.Seconds())},
	}
	body, err := prometheusGET(ctx, k8sCfg, ref, externalURL, bearer, "/api/v1/query_range", params)
	if err != nil {
		return nil, err
	}
	var parsed promAPIResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if parsed.Status != "success" {
		msg := parsed.Error
		if msg == "" {
			msg = "prometheus query failed"
		}
		return nil, fmt.Errorf("%s", msg)
	}
	out := map[int64]float64{}
	for _, r := range parsed.Data.Result {
		for _, pair := range r.Values {
			if len(pair) < 2 {
				continue
			}
			var ts float64
			var val string
			if err := json.Unmarshal(pair[0], &ts); err != nil {
				continue
			}
			if err := json.Unmarshal(pair[1], &val); err != nil {
				continue
			}
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				continue
			}
			out[int64(ts)] = f
		}
	}
	return out, nil
}

func mergePromSeries(cpu, mem map[int64]float64) []MetricPoint {
	secs := make([]int64, 0, len(cpu)+len(mem))
	seen := map[int64]struct{}{}
	for t := range cpu {
		if _, ok := seen[t]; !ok {
			seen[t] = struct{}{}
			secs = append(secs, t)
		}
	}
	for t := range mem {
		if _, ok := seen[t]; !ok {
			seen[t] = struct{}{}
			secs = append(secs, t)
		}
	}
	sort.Slice(secs, func(i, j int) bool { return secs[i] < secs[j] })
	out := make([]MetricPoint, 0, len(secs))
	var lastCPU, lastMem int64
	var haveCPU, haveMem bool
	for _, t := range secs {
		p := MetricPoint{Timestamp: t} // seconds — same as collector / frontend pointTsSec
		if v, ok := cpu[t]; ok {
			if v < 0 {
				v = 0
			}
			lastCPU = int64(v + 0.5)
			haveCPU = true
		}
		if v, ok := mem[t]; ok {
			if v < 0 {
				v = 0
			}
			lastMem = int64(v + 0.5)
			haveMem = true
		}
		if haveCPU {
			p.CPUMilli = lastCPU
		}
		if haveMem {
			p.MemBytes = lastMem
		}
		out = append(out, p)
	}
	return out
}

// ResolvePrometheusEndpoint picks Service ref / external URL from prefs + discovery.
func ResolvePrometheusEndpoint(ctx context.Context, k8sCfg *rest.Config, prefs MetricsSourcePrefs) (ref PrometheusRef, externalURL, bearer string, ok bool) {
	bearer = prefs.PrometheusBearer
	if prefs.PrometheusNamespace != "" && prefs.PrometheusService != "" {
		port := prefs.PrometheusPort
		if port == "" {
			port = "9090"
		}
		ref = PrometheusRef{Namespace: prefs.PrometheusNamespace, Name: prefs.PrometheusService, Port: port}
		if prometheusHealthy(ctx, k8sCfg, ref, "") {
			return ref, "", bearer, true
		}
		// Still try even if health check fails — query may work.
		return ref, "", bearer, true
	}
	if prefs.PrometheusURL != "" {
		return PrometheusRef{}, prefs.PrometheusURL, bearer, true
	}
	cands, err := discoverPrometheusCached(ctx, k8sCfg, false)
	if err != nil || len(cands) == 0 {
		return PrometheusRef{}, "", "", false
	}
	// Prefer first healthy among top candidates.
	for i, c := range cands {
		if i >= 5 {
			break
		}
		if prometheusHealthy(ctx, k8sCfg, c, "") {
			return c, "", bearer, true
		}
	}
	return cands[0], "", bearer, true
}
