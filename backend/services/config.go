package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func appConfigPath() string { return filepath.Join(DataDir(), "app-config.json") }

type ProfileMeta struct {
	Name        string `json:"name"`
	Type        string `json:"type"` // "aws" | "kubeconfig" | "gcp" | "azure"
	Region      string `json:"region,omitempty"`
	RoleARN     string `json:"roleArn,omitempty"`
	MFASerial   string `json:"mfaSerial,omitempty"`
	ClusterName string `json:"clusterName,omitempty"`
	// DisplayName is a user-chosen label in the app. Empty = derive from clusterName.
	DisplayName    string `json:"displayName,omitempty"`
	Group          string `json:"group,omitempty"`
	ProjectID      string `json:"projectId,omitempty"`      // GCP project ID
	SubscriptionID string `json:"subscriptionId,omitempty"` // Azure subscription ID
	ResourceGroup  string `json:"resourceGroup,omitempty"`  // Azure resource group
	// KubeconfigPath: when set, kubeconfig is always re-read from this file
	// (e.g. ~/.kube/config). Empty means content is stored in the vault.
	KubeconfigPath string `json:"kubeconfigPath,omitempty"`
	// KubeconfigEmbedded: user pasted YAML — never auto-link to local files.
	KubeconfigEmbedded bool `json:"kubeconfigEmbedded,omitempty"`
	// User confirmed kubeconfig exec plugins / insecure TLS for this profile.
	AllowExec        bool `json:"allowExec,omitempty"`
	AllowInsecureTLS bool `json:"allowInsecureTLS,omitempty"`
	// Metrics history source: empty/auto | prometheus | collector (local prefs, not in-cluster).
	MetricsSource       string `json:"metricsSource,omitempty"`
	PrometheusNamespace string `json:"prometheusNamespace,omitempty"`
	PrometheusService   string `json:"prometheusService,omitempty"`
	PrometheusPort      string `json:"prometheusPort,omitempty"`
	PrometheusURL       string `json:"prometheusURL,omitempty"`
	PrometheusBearer    string `json:"prometheusBearer,omitempty"`
}

type AppConfig struct {
	Profiles map[string]ProfileMeta `json:"profiles"`
	Groups   []string               `json:"groups,omitempty"` // ordered list of group names
	// Contexts from a live-linked kubeconfig that must not be auto-created:
	// skipped at first import, or deleted later in the app. Keyed by path.
	// Missing key = not snapshotted yet.
	KubeconfigDeferred map[string][]string `json:"kubeconfigDeferred,omitempty"`
}

func LoadAppConfig() (*AppConfig, error) {
	data, err := os.ReadFile(appConfigPath())
	if os.IsNotExist(err) {
		return &AppConfig{Profiles: map[string]ProfileMeta{}}, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Profiles == nil {
		cfg.Profiles = map[string]ProfileMeta{}
	}
	// Normalise all keys and Name fields to lowercase for consistent lookups.
	normalised := make(map[string]ProfileMeta, len(cfg.Profiles))
	for k, p := range cfg.Profiles {
		p.Name = strings.ToLower(p.Name)
		normalised[strings.ToLower(k)] = p
	}
	cfg.Profiles = normalised
	return &cfg, nil
}

func SaveAppConfig(cfg *AppConfig) error {
	if err := os.MkdirAll(filepath.Dir(appConfigPath()), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(appConfigPath(), data, 0600)
}

func SaveProfile(p ProfileMeta) error {
	p.Name = strings.ToLower(p.Name)
	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	cfg.Profiles[p.Name] = p
	return SaveAppConfig(cfg)
}

func DeleteProfileMeta(name string) error {
	liveKubeSyncMu.Lock()
	defer liveKubeSyncMu.Unlock()

	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	key := strings.ToLower(name)
	if p, ok := cfg.Profiles[key]; ok && isLiveKubeconfigProfile(p) {
		deferLiveKubeconfigContext(cfg, p.KubeconfigPath, p.ClusterName)
	}
	delete(cfg.Profiles, key)
	pruneKubeconfigDeferred(cfg)
	return SaveAppConfig(cfg)
}

func AddGroup(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	for _, g := range cfg.Groups {
		if g == name {
			return nil // already exists
		}
	}
	cfg.Groups = append(cfg.Groups, name)
	return SaveAppConfig(cfg)
}

func DeleteGroup(name string) ([]string, error) {
	liveKubeSyncMu.Lock()
	defer liveKubeSyncMu.Unlock()

	cfg, err := LoadAppConfig()
	if err != nil {
		return nil, err
	}
	var removed []string
	for k, p := range cfg.Profiles {
		if p.Group != name {
			continue
		}
		if isLiveKubeconfigProfile(p) {
			deferLiveKubeconfigContext(cfg, p.KubeconfigPath, p.ClusterName)
		}
		removed = append(removed, k)
		delete(cfg.Profiles, k)
	}
	groups := cfg.Groups[:0]
	for _, g := range cfg.Groups {
		if g != name {
			groups = append(groups, g)
		}
	}
	cfg.Groups = groups
	pruneKubeconfigDeferred(cfg)
	return removed, SaveAppConfig(cfg)
}

func RenameGroup(oldName, newName string) error {
	newName = strings.TrimSpace(newName)
	if newName == "" || oldName == newName {
		return nil
	}
	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	for i, g := range cfg.Groups {
		if g == oldName {
			cfg.Groups[i] = newName
			break
		}
	}
	for k, p := range cfg.Profiles {
		if p.Group == oldName {
			p.Group = newName
			cfg.Profiles[k] = p
		}
	}
	return SaveAppConfig(cfg)
}

func SetProfileGroup(profileName, group string) error {
	profileName = strings.ToLower(profileName)
	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	p, ok := cfg.Profiles[profileName]
	if !ok {
		return nil
	}
	p.Group = group
	cfg.Profiles[profileName] = p
	return SaveAppConfig(cfg)
}

const displayNameMaxLen = 80

// SetProfileDisplayName stores a local-only alias. Empty displayName clears it
// so the UI falls back to the real cluster/context name. Does not rename the
// Kubernetes cluster or the opaque profile id.
func SetProfileDisplayName(profileName, displayName string) error {
	profileName = strings.ToLower(profileName)
	displayName = strings.TrimSpace(displayName)
	if len([]rune(displayName)) > displayNameMaxLen {
		displayName = string([]rune(displayName)[:displayNameMaxLen])
	}
	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	p, ok := cfg.Profiles[profileName]
	if !ok {
		return os.ErrNotExist
	}
	p.DisplayName = displayName
	cfg.Profiles[profileName] = p
	return SaveAppConfig(cfg)
}
