package services

import (
	"context"
	"sort"
	"sync"
	"time"

	rest "k8s.io/client-go/rest"
)

const (
	historyMaxPoints = 720 // 720 × 5s = 1 hour
	historyInterval  = 5 * time.Second
)

type MetricPoint struct {
	Timestamp int64 `json:"ts"`
	CPUMilli  int64 `json:"cpuMilli"`
	MemBytes  int64 `json:"memBytes"`
}

type profileHistory struct {
	mu       sync.RWMutex
	podData  map[string][]MetricPoint // "namespace/name" → points
	nodeData map[string][]MetricPoint // nodeName → points
}

type MetricsCollector struct {
	mu       sync.Mutex
	profiles map[string]*profileHistory
	cancels  map[string]context.CancelFunc
}

var GlobalMetricsCollector = &MetricsCollector{
	profiles: make(map[string]*profileHistory),
	cancels:  make(map[string]context.CancelFunc),
}

// EnsureStarted starts background collection for profileName if not already running.
// getCfg is called each tick to get a fresh k8s config (handles token refresh).
func (mc *MetricsCollector) EnsureStarted(profileName string, getCfg func(ctx context.Context) (*rest.Config, error)) {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	if _, ok := mc.profiles[profileName]; ok {
		return
	}
	h := &profileHistory{
		podData:  make(map[string][]MetricPoint),
		nodeData: make(map[string][]MetricPoint),
	}
	mc.profiles[profileName] = h
	ctx, cancel := context.WithCancel(context.Background())
	mc.cancels[profileName] = cancel
	go mc.loop(ctx, h, getCfg)
}

// GetHistory returns the accumulated metric points for a specific pod.
func (mc *MetricsCollector) GetHistory(profileName, namespace, podName string) []MetricPoint {
	mc.mu.Lock()
	h := mc.profiles[profileName]
	mc.mu.Unlock()
	if h == nil {
		return nil
	}
	key := namespace + "/" + podName
	h.mu.RLock()
	defer h.mu.RUnlock()
	src := h.podData[key]
	if len(src) == 0 {
		return nil
	}
	out := make([]MetricPoint, len(src))
	copy(out, src)
	return out
}

// GetNodeHistory returns the accumulated metric points for a specific node.
func (mc *MetricsCollector) GetNodeHistory(profileName, nodeName string) []MetricPoint {
	mc.mu.Lock()
	h := mc.profiles[profileName]
	mc.mu.Unlock()
	if h == nil {
		return nil
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	src := h.nodeData[nodeName]
	if len(src) == 0 {
		return nil
	}
	out := make([]MetricPoint, len(src))
	copy(out, src)
	return out
}

// MergeMetricHistories combines collector samples with the local 5s buffer.
// Client samples win for the last ~15 seconds.
func MergeMetricHistories(server, client []MetricPoint, maxPoints int) []MetricPoint {
	if len(server) == 0 {
		return tailPoints(client, maxPoints)
	}
	if len(client) == 0 {
		return tailPoints(server, maxPoints)
	}
	nowSec := time.Now().Unix()
	recentCutoff := nowSec - 15
	bySec := make(map[int64]MetricPoint, len(server)+len(client))

	tsSec := func(p MetricPoint) int64 {
		if p.Timestamp > 1_000_000_000_000 {
			return p.Timestamp / 1000
		}
		return p.Timestamp
	}

	for _, p := range server {
		bySec[tsSec(p)] = p
	}
	for _, p := range client {
		sec := tsSec(p)
		if _, ok := bySec[sec]; !ok || sec >= recentCutoff {
			bySec[sec] = p
		}
	}

	secs := make([]int64, 0, len(bySec))
	for sec := range bySec {
		secs = append(secs, sec)
	}
	sort.Slice(secs, func(i, j int) bool { return secs[i] < secs[j] })

	merged := make([]MetricPoint, len(secs))
	for i, sec := range secs {
		merged[i] = bySec[sec]
	}
	return tailPoints(merged, maxPoints)
}

func tailPoints(points []MetricPoint, maxPoints int) []MetricPoint {
	if maxPoints <= 0 || len(points) <= maxPoints {
		return points
	}
	return points[len(points)-maxPoints:]
}

func (mc *MetricsCollector) loop(ctx context.Context, h *profileHistory, getCfg func(ctx context.Context) (*rest.Config, error)) {
	mc.tick(ctx, h, getCfg)
	t := time.NewTicker(historyInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			mc.tick(ctx, h, getCfg)
		}
	}
}

func (mc *MetricsCollector) tick(ctx context.Context, h *profileHistory, getCfg func(ctx context.Context) (*rest.Config, error)) {
	cfg, err := getCfg(ctx)
	if err != nil {
		return
	}
	now := time.Now().Unix()

	podMetrics, err := ListAllPodMetrics(ctx, cfg, "")
	if err == nil {
		h.mu.Lock()
		for key, m := range podMetrics {
			pts := h.podData[key]
			pts = append(pts, MetricPoint{Timestamp: now, CPUMilli: m.CPUMilli, MemBytes: m.MemBytes})
			if len(pts) > historyMaxPoints {
				pts = pts[len(pts)-historyMaxPoints:]
			}
			h.podData[key] = pts
		}
		h.mu.Unlock()
	}

	nodeMetrics, err := ListAllNodeMetrics(ctx, cfg)
	if err == nil {
		h.mu.Lock()
		for nodeName, m := range nodeMetrics {
			pts := h.nodeData[nodeName]
			pts = append(pts, MetricPoint{Timestamp: now, CPUMilli: m.CPUMilli, MemBytes: m.MemBytes})
			if len(pts) > historyMaxPoints {
				pts = pts[len(pts)-historyMaxPoints:]
			}
			h.nodeData[nodeName] = pts
		}
		h.mu.Unlock()
	}
}
