package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	rest "k8s.io/client-go/rest"
)

// IsMetricsUnavailable reports whether err means the metrics API is not
// installed or the object has not been scraped yet — i.e. the caller should
// return an empty result rather than surface an error. It prefers typed API
// errors and falls back to message matching for errors that arrive as plain
// text (e.g. from RESTClient().DoRaw).
func IsMetricsUnavailable(err error) bool {
	if err == nil {
		return false
	}
	if k8serrors.IsNotFound(err) || meta.IsNoMatchError(err) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "404") ||
		strings.Contains(msg, "not found") ||
		strings.Contains(msg, "the server could not find") ||
		strings.Contains(msg, "no matches for kind")
}

type ContainerMetrics struct {
	Name     string `json:"name"`
	CPU      string `json:"cpu"`
	Memory   string `json:"memory"`
	CPUMilli int64  `json:"cpuMilli"` // millicores
	MemBytes int64  `json:"memBytes"` // bytes
}

type PodMetrics struct {
	Containers []ContainerMetrics `json:"containers"`
}

type PodMetricsSummary struct {
	CPUMilli int64 `json:"cpuMilli"`
	MemBytes int64 `json:"memBytes"`
}

type metricsUsage struct {
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
}

type podMetricsList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Containers []struct {
			Name  string       `json:"name"`
			Usage metricsUsage `json:"usage"`
		} `json:"containers"`
	} `json:"items"`
}

type nodeMetricsList struct {
	Items []struct {
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
		Usage metricsUsage `json:"usage"`
	} `json:"items"`
}

// parseMetricsUsage converts metrics-server quantity strings to millicores and bytes.
func parseMetricsUsage(cpu, mem string) (cpuMilli, memBytes int64) {
	if q, err := resource.ParseQuantity(cpu); err == nil {
		cpuMilli = q.MilliValue()
	}
	if q, err := resource.ParseQuantity(mem); err == nil {
		memBytes = q.Value()
	}
	return
}

// ListAllPodMetrics returns a map of "namespace/name" → summary for all pods in the namespace
// (or all namespaces if namespace is "").
func ListAllPodMetrics(ctx context.Context, k8sCfg *rest.Config, namespace string) (map[string]PodMetricsSummary, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	var path string
	if namespace != "" {
		path = fmt.Sprintf("/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods", namespace)
	} else {
		path = "/apis/metrics.k8s.io/v1beta1/pods"
	}
	data, err := client.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var raw podMetricsList
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse metrics list: %w", err)
	}

	result := make(map[string]PodMetricsSummary, len(raw.Items))
	for _, item := range raw.Items {
		var totalCPU, totalMem int64
		for _, c := range item.Containers {
			cpu, mem := parseMetricsUsage(c.Usage.CPU, c.Usage.Memory)
			totalCPU += cpu
			totalMem += mem
		}
		key := item.Metadata.Namespace + "/" + item.Metadata.Name
		result[key] = PodMetricsSummary{CPUMilli: totalCPU, MemBytes: totalMem}
	}
	return result, nil
}

func GetPodMetrics(ctx context.Context, k8sCfg *rest.Config, namespace, podName string) (*PodMetrics, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	path := fmt.Sprintf("/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods/%s", namespace, podName)
	data, err := client.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}

	var raw struct {
		Containers []struct {
			Name  string       `json:"name"`
			Usage metricsUsage `json:"usage"`
		} `json:"containers"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse metrics: %w", err)
	}

	result := &PodMetrics{Containers: make([]ContainerMetrics, 0, len(raw.Containers))}
	for _, c := range raw.Containers {
		cpuMilli, memBytes := parseMetricsUsage(c.Usage.CPU, c.Usage.Memory)
		result.Containers = append(result.Containers, ContainerMetrics{
			Name:     c.Name,
			CPU:      formatCPU(c.Usage.CPU),
			Memory:   formatMemory(c.Usage.Memory),
			CPUMilli: cpuMilli,
			MemBytes: memBytes,
		})
	}
	return result, nil
}

type NodeMetricsSummary struct {
	CPUMilli      int64 `json:"cpuMilli"`
	MemBytes      int64 `json:"memBytes"`
	DiskUsedBytes int64 `json:"diskUsedBytes"`
	DiskCapBytes  int64 `json:"diskCapBytes"`
}

func ListAllNodeMetrics(ctx context.Context, k8sCfg *rest.Config) (map[string]NodeMetricsSummary, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}
	data, err := client.RESTClient().Get().AbsPath("/apis/metrics.k8s.io/v1beta1/nodes").DoRaw(ctx)
	if err != nil {
		return nil, err
	}
	var raw nodeMetricsList
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse node metrics: %w", err)
	}
	result := make(map[string]NodeMetricsSummary, len(raw.Items))
	for _, item := range raw.Items {
		cpuMilli, memBytes := parseMetricsUsage(item.Usage.CPU, item.Usage.Memory)
		result[item.Metadata.Name] = NodeMetricsSummary{
			CPUMilli: cpuMilli,
			MemBytes: memBytes,
		}
	}
	return result, nil
}

func GetNodeMetrics(ctx context.Context, k8sCfg *rest.Config, nodeName string) (*NodeMetricsSummary, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	path := fmt.Sprintf("/apis/metrics.k8s.io/v1beta1/nodes/%s", nodeName)
	data, err := client.RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return nil, err
	}
	var rawMetrics struct {
		Usage metricsUsage `json:"usage"`
	}
	if err := json.Unmarshal(data, &rawMetrics); err != nil {
		return nil, fmt.Errorf("parse node metrics: %w", err)
	}
	cpuMilli, memBytes := parseMetricsUsage(rawMetrics.Usage.CPU, rawMetrics.Usage.Memory)

	result := &NodeMetricsSummary{
		CPUMilli: cpuMilli,
		MemBytes: memBytes,
	}

	// Best-effort: get disk usage from kubelet stats/summary proxy.
	statsPath := fmt.Sprintf("/api/v1/nodes/%s/proxy/stats/summary", nodeName)
	statsData, err := client.RESTClient().Get().AbsPath(statsPath).DoRaw(ctx)
	if err == nil {
		var stats struct {
			Node struct {
				Fs struct {
					UsedBytes     *int64 `json:"usedBytes"`
					CapacityBytes *int64 `json:"capacityBytes"`
				} `json:"fs"`
			} `json:"node"`
		}
		if json.Unmarshal(statsData, &stats) == nil {
			if stats.Node.Fs.UsedBytes != nil {
				result.DiskUsedBytes = *stats.Node.Fs.UsedBytes
			}
			if stats.Node.Fs.CapacityBytes != nil {
				result.DiskCapBytes = *stats.Node.Fs.CapacityBytes
			}
		}
	}

	return result, nil
}

func formatCPU(s string) string {
	if s == "" {
		return "—"
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return s
	}
	mc := q.MilliValue()
	if mc >= 1000 {
		return fmt.Sprintf("%.2fc", float64(mc)/1000.0)
	}
	return fmt.Sprintf("%dm", mc)
}

func formatMemory(s string) string {
	if s == "" {
		return "—"
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return s
	}
	b := q.Value()
	switch {
	case b >= 1<<30:
		return fmt.Sprintf("%.1fGi", float64(b)/(1<<30))
	case b >= 1<<20:
		return fmt.Sprintf("%.0fMi", float64(b)/(1<<20))
	case b >= 1<<10:
		return fmt.Sprintf("%.0fKi", float64(b)/(1<<10))
	default:
		return fmt.Sprintf("%dB", b)
	}
}
