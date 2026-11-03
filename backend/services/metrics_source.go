package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	rest "k8s.io/client-go/rest"
)

// HistoryResolution is the result of resolving metrics history for charts.
type HistoryResolution struct {
	Points []MetricPoint
	Source string // prometheus | cluster | local | none
}

// ResolveMetricsHistory picks prometheus / collector / local per prefs.
// kind: cluster | node | pod
//
// Auto: use Prometheus when available. If the built-in collector is installed and
// returns history, it takes over. An empty/pending collector must not hide Prometheus
// (otherwise charts look like they restart from scratch after every app launch).
// Explicit "prometheus" / "collector" force that source only.
// historySourcePref maps stored prefs to resolution mode. Legacy "collector" meant
// "use the in-cluster collector" in old UI but blocked Prometheus fallback after restart.
func historySourcePref(prefs MetricsSourcePrefs) string {
	src := NormalizeMetricsSource(prefs.Source)
	if src == "collector" {
		return "auto"
	}
	return src
}

func ResolveMetricsHistory(
	ctx context.Context,
	profileName string,
	k8sCfg *rest.Config,
	prefs MetricsSourcePrefs,
	kind, id, namespace string,
	local []MetricPoint,
) HistoryResolution {
	// Cap long Prometheus/collector queries, but still honor caller cancel (page leave).
	qCtx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	src := historySourcePref(prefs)

	tryProm := src == "auto" || src == "prometheus"
	tryCollector := src == "auto" || src == "collector"

	collectorOn := false
	if tryCollector && k8sCfg != nil {
		if st, err := GetCollectorStatus(qCtx, k8sCfg); err == nil && st != nil {
			switch st.State {
			case "running", "pending", "error":
				collectorOn = true
			}
		}
	}

	if tryCollector && collectorOn && k8sCfg != nil {
		pts, fromCluster, _ := HistoryFromCollector(qCtx, k8sCfg, kind, id, namespace)
		if fromCluster && len(pts) > 0 {
			return HistoryResolution{
				Points: mergeHistoryCap(pts, local),
				Source: "cluster",
			}
		}
		if src == "collector" {
			return localHistory(local)
		}
		// Auto + collector installed but no series yet → keep trying Prometheus below.
	} else if src == "collector" {
		return localHistory(local)
	}

	if tryProm && k8sCfg != nil {
		ref, ext, bearer, ok := ResolvePrometheusEndpoint(qCtx, k8sCfg, prefs)
		if ok {
			since := time.Now().Add(-14 * 24 * time.Hour)
			pts, err := QueryPrometheusHistory(qCtx, k8sCfg, ref, ext, bearer, kind, id, namespace, since, time.Now())
			if err == nil && len(pts) > 0 {
				if ext == "" {
					MaybePersistDiscoveredPrometheus(profileName, ref)
				}
				return HistoryResolution{
					Points: mergeHistoryCap(pts, local),
					Source: "prometheus",
				}
			}
			if src == "prometheus" {
				return localHistory(local)
			}
		} else if src == "prometheus" {
			return localHistory(local)
		}
	}

	return localHistory(local)
}

func mergeHistoryCap(remote, local []MetricPoint) []MetricPoint {
	capN := 720
	if len(remote) > 500 {
		capN = 20_000
	}
	if local == nil {
		local = []MetricPoint{}
	}
	return MergeMetricHistories(remote, local, capN)
}

func localHistory(local []MetricPoint) HistoryResolution {
	if local == nil {
		local = []MetricPoint{}
	}
	if len(local) == 0 {
		return HistoryResolution{Points: local, Source: "none"}
	}
	return HistoryResolution{Points: local, Source: "local"}
}

// LoadProfileMetricsPrefs loads metrics prefs for a profile name.
func LoadProfileMetricsPrefs(profileName string) MetricsSourcePrefs {
	cfg, err := LoadAppConfig()
	if err != nil {
		return MetricsSourcePrefs{Source: "auto"}
	}
	p, ok := cfg.Profiles[strings.ToLower(profileName)]
	if !ok {
		return MetricsSourcePrefs{Source: "auto"}
	}
	return PrefsFromProfile(p)
}

// SaveProfileMetricsPrefs merges metrics prefs into an existing profile.
func SaveProfileMetricsPrefs(profileName string, prefs MetricsSourcePrefs) error {
	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	key := strings.ToLower(profileName)
	p, ok := cfg.Profiles[key]
	if !ok {
		return fmt.Errorf("profile not found")
	}
	ApplyMetricsPrefs(&p, prefs)
	cfg.Profiles[key] = p
	return SaveAppConfig(cfg)
}

// MaybePersistDiscoveredPrometheus saves the first working Service ref so cold starts
// do not depend on re-discovery before history queries.
func MaybePersistDiscoveredPrometheus(profileName string, ref PrometheusRef) {
	if ref.Namespace == "" || ref.Name == "" {
		return
	}
	prefs := LoadProfileMetricsPrefs(profileName)
	if prefs.PrometheusURL != "" {
		return
	}
	if prefs.PrometheusNamespace != "" && prefs.PrometheusService != "" {
		return
	}
	prefs.PrometheusNamespace = ref.Namespace
	prefs.PrometheusService = ref.Name
	prefs.PrometheusPort = ref.Port
	_ = SaveProfileMetricsPrefs(profileName, prefs)
}

func migrateLegacyMetricsSource(profileName string, prefs MetricsSourcePrefs) MetricsSourcePrefs {
	if NormalizeMetricsSource(prefs.Source) != "collector" {
		return prefs
	}
	prefs.Source = "auto"
	_ = SaveProfileMetricsPrefs(profileName, prefs)
	return prefs
}

// MigrateLegacyMetricsSourcePublic loads prefs and rewrites legacy source=collector to auto.
func MigrateLegacyMetricsSourcePublic(profileName string) MetricsSourcePrefs {
	return migrateLegacyMetricsSource(profileName, LoadProfileMetricsPrefs(profileName))
}
