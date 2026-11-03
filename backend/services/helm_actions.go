package services

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/downloader"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/registry"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/yaml"
)

func helmActionConfig(k8sCfg *rest.Config, namespace string) (*action.Configuration, error) {
	cfg := new(action.Configuration)
	g := &restClientGetter{cfg: k8sCfg, namespace: namespace}
	if err := cfg.Init(g, namespace, "secret", func(string, ...interface{}) {}); err != nil {
		return nil, fmt.Errorf("init helm action config: %w", err)
	}
	return cfg, nil
}

func helmSettings() *cli.EnvSettings {
	settings := cli.New()
	_ = os.MkdirAll(settings.RepositoryCache, 0o755)
	return settings
}

func requireNsName(namespace, name string) error {
	if namespace == "" || name == "" {
		return fmt.Errorf("namespace and name are required")
	}
	return nil
}

// runCancellable runs fn in a goroutine and returns ctx.Err() if the context
// cancels first. Non-nil errors from fn are wrapped with label.
func runCancellable(ctx context.Context, label string, fn func() error) error {
	done := make(chan error, 1)
	go func() { done <- fn() }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if err != nil {
			return fmt.Errorf("%s: %w", label, err)
		}
		return nil
	}
}

func helmSettingsWithRegistry() (*cli.EnvSettings, *registry.Client, error) {
	settings := helmSettings()
	regClient, err := newRegistryClient(settings)
	if err != nil {
		return nil, nil, err
	}
	return settings, regClient, nil
}

func parseValuesYAML(valuesYAML string) (map[string]interface{}, error) {
	valuesYAML = strings.TrimSpace(valuesYAML)
	if valuesYAML == "" {
		return map[string]interface{}{}, nil
	}
	vals, err := chartutil.ReadValues([]byte(valuesYAML))
	if err != nil {
		return nil, fmt.Errorf("parse values YAML: %w", err)
	}
	return vals.AsMap(), nil
}

// HelmChartWriteOpts is shared by install / upgrade.
type HelmChartWriteOpts struct {
	Chart      string // chart ref, path, or oci://…
	RepoURL    string // optional --repo
	Version    string // optional chart version
	ValuesYAML string
}

func applyChartPathOptions(cpo *action.ChartPathOptions, opts HelmChartWriteOpts) {
	cpo.RepoURL = strings.TrimSpace(opts.RepoURL)
	cpo.Version = strings.TrimSpace(opts.Version)
}

func newRegistryClient(settings *cli.EnvSettings) (*registry.Client, error) {
	return registry.NewClient(
		registry.ClientOptDebug(settings.Debug),
		registry.ClientOptEnableCache(true),
		registry.ClientOptWriter(os.Stderr),
		registry.ClientOptCredentialsFile(settings.RegistryConfig),
	)
}

func chartRefNeedsRepoURL(chartRef, repoURL string) bool {
	if strings.TrimSpace(repoURL) != "" {
		return false
	}
	ref := strings.TrimSpace(chartRef)
	if ref == "" {
		return false
	}
	if strings.HasPrefix(ref, "oci://") || strings.HasPrefix(ref, "/") || strings.HasPrefix(ref, ".") || strings.HasPrefix(ref, "file:") {
		return false
	}
	if strings.HasSuffix(ref, ".tgz") || strings.HasSuffix(ref, ".tar.gz") {
		return false
	}
	// Bare name (podinfo) or repo/chart without a configured local Helm repo — ask for Repo URL.
	return true
}

func loadChart(cpo *action.ChartPathOptions, chartRef string, settings *cli.EnvSettings, regClient *registry.Client) (*chart.Chart, error) {
	chartRef = strings.TrimSpace(chartRef)
	if chartRef == "" {
		return nil, fmt.Errorf("chart is required")
	}
	if chartRefNeedsRepoURL(chartRef, cpo.RepoURL) {
		return nil, fmt.Errorf("repo URL is required for chart %q (or use an oci://… ref)", chartRef)
	}

	chartPath, err := cpo.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("locate chart: %w", err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("load chart: %w", err)
	}

	if req := ch.Metadata.Dependencies; req != nil {
		if err := action.CheckDependencies(ch, req); err != nil {
			man := &downloader.Manager{
				Out:              os.Stderr,
				ChartPath:        chartPath,
				Keyring:          cpo.Keyring,
				SkipUpdate:       false,
				Getters:          getter.All(settings),
				RepositoryConfig: settings.RepositoryConfig,
				RepositoryCache:  settings.RepositoryCache,
				RegistryClient:   regClient,
			}
			if uerr := man.Update(); uerr != nil {
				return nil, fmt.Errorf("update chart dependencies: %v (also: %w)", uerr, err)
			}
			ch, err = loader.Load(chartPath)
			if err != nil {
				return nil, fmt.Errorf("reload chart after deps: %w", err)
			}
		}
	}
	return ch, nil
}

// GetHelmChartDefaultValuesYAML returns the chart's packaged values.yaml for a repo chart version.
func GetHelmChartDefaultValuesYAML(chartRef, repoURL, version string) (string, error) {
	chartRef = strings.TrimSpace(chartRef)
	if chartRef == "" {
		return "", fmt.Errorf("chart is required")
	}
	settings := helmSettings()
	regClient, err := newRegistryClient(settings)
	if err != nil {
		return "", err
	}
	var cpo action.ChartPathOptions
	applyChartPathOptions(&cpo, HelmChartWriteOpts{
		Chart:   chartRef,
		RepoURL: repoURL,
		Version: version,
	})
	ch, err := loadChart(&cpo, chartRef, settings, regClient)
	if err != nil {
		return "", err
	}
	for _, f := range ch.Raw {
		if f == nil {
			continue
		}
		// Top-level values.yaml only (not charts/*/values.yaml).
		if f.Name == "values.yaml" {
			return string(f.Data), nil
		}
	}
	if len(ch.Values) == 0 {
		return "", nil
	}
	b, err := yaml.Marshal(ch.Values)
	if err != nil {
		return "", fmt.Errorf("marshal chart values: %w", err)
	}
	return string(b), nil
}

// UninstallHelmRelease uninstalls a release (purge history by default).
func UninstallHelmRelease(ctx context.Context, k8sCfg *rest.Config, namespace, name string, keepHistory bool) error {
	if err := requireNsName(namespace, name); err != nil {
		return err
	}
	cfg, err := helmActionConfig(k8sCfg, namespace)
	if err != nil {
		return err
	}
	un := action.NewUninstall(cfg)
	un.Wait = true
	un.Timeout = 5 * time.Minute
	un.KeepHistory = keepHistory

	return runCancellable(ctx, "helm uninstall", func() error {
		_, err := un.Run(name)
		return err
	})
}

// RollbackHelmRelease rolls a release back to a specific revision.
func RollbackHelmRelease(ctx context.Context, k8sCfg *rest.Config, namespace, name string, revision int) error {
	if err := requireNsName(namespace, name); err != nil {
		return err
	}
	if revision < 1 {
		return fmt.Errorf("revision must be >= 1")
	}
	cfg, err := helmActionConfig(k8sCfg, namespace)
	if err != nil {
		return err
	}
	rb := action.NewRollback(cfg)
	rb.Version = revision
	rb.Wait = true
	rb.Timeout = 5 * time.Minute
	rb.CleanupOnFail = true
	rb.Force = true

	return runCancellable(ctx, "helm rollback", func() error {
		return rb.Run(name)
	})
}

// GetHelmReleaseValuesYAML returns user-supplied values for a release as YAML.
func GetHelmReleaseValuesYAML(ctx context.Context, k8sCfg *rest.Config, namespace, name string, all bool) (string, error) {
	if err := requireNsName(namespace, name); err != nil {
		return "", err
	}
	cfg, err := helmActionConfig(k8sCfg, namespace)
	if err != nil {
		return "", err
	}
	gv := action.NewGetValues(cfg)
	gv.AllValues = all

	type result struct {
		vals map[string]interface{}
		err  error
	}
	done := make(chan result, 1)
	go func() {
		vals, err := gv.Run(name)
		done <- result{vals, err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case r := <-done:
		if r.err != nil {
			return "", fmt.Errorf("helm get values: %w", r.err)
		}
		if len(r.vals) == 0 {
			return "", nil
		}
		b, err := yaml.Marshal(r.vals)
		if err != nil {
			return "", fmt.Errorf("marshal values: %w", err)
		}
		return string(b), nil
	}
}

// InstallHelmRelease installs a chart as a new release.
func InstallHelmRelease(ctx context.Context, k8sCfg *rest.Config, namespace, name string, opts HelmChartWriteOpts) error {
	if err := requireNsName(namespace, name); err != nil {
		return err
	}
	vals, err := parseValuesYAML(opts.ValuesYAML)
	if err != nil {
		return err
	}
	cfg, err := helmActionConfig(k8sCfg, namespace)
	if err != nil {
		return err
	}
	settings, regClient, err := helmSettingsWithRegistry()
	if err != nil {
		return err
	}
	cfg.RegistryClient = regClient
	inst := action.NewInstall(cfg)
	inst.ReleaseName = name
	inst.Namespace = namespace
	inst.CreateNamespace = true
	inst.Wait = true
	inst.Timeout = 10 * time.Minute
	applyChartPathOptions(&inst.ChartPathOptions, opts)

	ch, err := loadChart(&inst.ChartPathOptions, opts.Chart, settings, regClient)
	if err != nil {
		return err
	}

	return runCancellable(ctx, "helm install", func() error {
		_, err := inst.RunWithContext(ctx, ch, vals)
		return err
	})
}

// UpgradeHelmRelease upgrades an existing release.
func UpgradeHelmRelease(ctx context.Context, k8sCfg *rest.Config, namespace, name string, opts HelmChartWriteOpts, reuseValues bool) error {
	if err := requireNsName(namespace, name); err != nil {
		return err
	}
	vals, err := parseValuesYAML(opts.ValuesYAML)
	if err != nil {
		return err
	}
	cfg, err := helmActionConfig(k8sCfg, namespace)
	if err != nil {
		return err
	}
	settings, regClient, err := helmSettingsWithRegistry()
	if err != nil {
		return err
	}
	cfg.RegistryClient = regClient
	up := action.NewUpgrade(cfg)
	up.Namespace = namespace
	up.Wait = true
	up.Timeout = 10 * time.Minute
	up.CleanupOnFail = true
	// Helm --reuse-values pins the *coalesced* old chart values (including baked
	// image.tag). ResetThenReuseValues keeps user overrides but takes new chart defaults.
	valsEmpty := len(vals) == 0
	switch {
	case reuseValues && valsEmpty:
		up.ResetThenReuseValues = true
	case valsEmpty:
		up.ResetValues = true
	default:
		// Explicit values YAML — merge onto new chart defaults only (no old release config).
	}
	applyChartPathOptions(&up.ChartPathOptions, opts)

	chartRef := strings.TrimSpace(opts.Chart)
	if chartRef == "" {
		hist := action.NewHistory(cfg)
		hist.Max = 1
		rels, herr := hist.Run(name)
		if herr != nil || len(rels) == 0 {
			return fmt.Errorf("chart is required (could not infer from release: %v)", herr)
		}
		chartRef = rels[0].Chart.Metadata.Name
		if up.Version == "" && rels[0].Chart.Metadata.Version != "" {
			up.Version = rels[0].Chart.Metadata.Version
		}
	}

	ch, err := loadChart(&up.ChartPathOptions, chartRef, settings, regClient)
	if err != nil {
		return err
	}
	if want := strings.TrimSpace(opts.Version); want != "" && ch.Metadata != nil && ch.Metadata.Version != want {
		return fmt.Errorf("loaded chart version %q does not match requested %q", ch.Metadata.Version, want)
	}

	return runCancellable(ctx, "helm upgrade", func() error {
		_, err := up.RunWithContext(ctx, name, ch, vals)
		return err
	})
}
