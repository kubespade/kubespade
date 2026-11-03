package services

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// KubeconfigInfo holds the parsed essentials from a kubeconfig for one context.
type KubeconfigInfo struct {
	ClusterName string // the cluster key within the context
	DisplayName string // short label for UI (strips EKS ARN etc.)
	Endpoint    string
	CAData      []byte
}

// KubeconfigContextEntry is a lightweight summary of one context.
type KubeconfigContextEntry struct {
	ContextName string `json:"contextName"`
	ClusterName string `json:"clusterName"`
	DisplayName string `json:"displayName"`
	Endpoint    string `json:"endpoint"`
}

// ShortClusterDisplayName turns long identifiers (EKS ARNs, path-like names)
// into a short UI label. Leaves normal names unchanged.
func ShortClusterDisplayName(name string) string {
	if name == "" {
		return name
	}
	// arn:aws:eks:region:account:cluster/my-name
	if i := strings.Index(name, ":cluster/"); i >= 0 {
		return name[i+len(":cluster/"):]
	}
	if strings.HasPrefix(name, "arn:") {
		if i := strings.LastIndex(name, "/"); i >= 0 && i+1 < len(name) {
			return name[i+1:]
		}
	}
	return name
}

// ProfileDisplayName derives the UI label for a profile from its metadata alone
// (no live session): the short cluster name, else a provider-specific fallback,
// else the opaque profile id.
func ProfileDisplayName(p ProfileMeta) string {
	if d := strings.TrimSpace(p.DisplayName); d != "" {
		return d
	}
	displayName := ShortClusterDisplayName(p.ClusterName)
	if displayName == "" {
		switch p.Type {
		case "aws":
			if p.Region != "" {
				displayName = "EKS (" + p.Region + ")"
			}
		case "gcp":
			if p.ProjectID != "" {
				displayName = "GKE (" + p.ProjectID + ")"
			}
		case "azure":
			displayName = "AKS"
		}
	}
	if displayName == "" {
		displayName = p.Name
	}
	return displayName
}

// ResolveKubeconfigDisplayName picks the best short label for a context:
// 1) exec --cluster-name / --cluster
// 2) short form of the cluster key
// 3) short form of the context name
func ResolveKubeconfigDisplayName(apiConfig *clientcmdapi.Config, contextName string) string {
	if apiConfig == nil {
		return ShortClusterDisplayName(contextName)
	}
	ctx, ok := apiConfig.Contexts[contextName]
	if !ok || ctx == nil {
		return ShortClusterDisplayName(contextName)
	}

	if auth, ok := apiConfig.AuthInfos[ctx.AuthInfo]; ok && auth != nil && auth.Exec != nil {
		args := auth.Exec.Args
		for i := 0; i < len(args)-1; i++ {
			switch args[i] {
			case "--cluster-name", "--cluster":
				if args[i+1] != "" {
					return args[i+1]
				}
			}
		}
	}

	if short := ShortClusterDisplayName(ctx.Cluster); short != "" && short != ctx.Cluster {
		return short
	}
	if short := ShortClusterDisplayName(contextName); short != "" {
		return short
	}
	return contextName
}

// ListKubeconfigContexts returns all contexts found in the kubeconfig,
// with the current context sorted first.
func ListKubeconfigContexts(kubeconfigData string) ([]KubeconfigContextEntry, error) {
	apiConfig, err := clientcmd.Load([]byte(kubeconfigData))
	if err != nil {
		return nil, fmt.Errorf("invalid kubeconfig: %w", err)
	}
	if len(apiConfig.Contexts) == 0 {
		return nil, fmt.Errorf("kubeconfig has no contexts")
	}

	entries := make([]KubeconfigContextEntry, 0, len(apiConfig.Contexts))
	for ctxName, ctx := range apiConfig.Contexts {
		entry := KubeconfigContextEntry{
			ContextName: ctxName,
			ClusterName: ctx.Cluster,
			DisplayName: ResolveKubeconfigDisplayName(apiConfig, ctxName),
		}
		if cl, ok := apiConfig.Clusters[ctx.Cluster]; ok {
			entry.Endpoint = cl.Server
		}
		entries = append(entries, entry)
	}
	current := apiConfig.CurrentContext
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].ContextName == current {
			return true
		}
		if entries[j].ContextName == current {
			return false
		}
		return entries[i].ContextName < entries[j].ContextName
	})
	return entries, nil
}

// ParseKubeconfigContextByName validates and returns info for the named context.
// If contextName is empty, it falls back to current-context.
func ParseKubeconfigContextByName(kubeconfigData, contextName string) (*KubeconfigInfo, error) {
	raw := []byte(kubeconfigData)
	apiConfig, err := clientcmd.Load(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid kubeconfig: %w", err)
	}

	contextName, err = resolveKubeconfigContext(apiConfig, contextName)
	if err != nil {
		return nil, err
	}

	ctx, ok := apiConfig.Contexts[contextName]
	if !ok {
		return nil, fmt.Errorf("context %q not found", contextName)
	}

	cluster, ok := apiConfig.Clusters[ctx.Cluster]
	if !ok {
		return nil, fmt.Errorf("cluster %q not found in kubeconfig", ctx.Cluster)
	}

	ca := cluster.CertificateAuthorityData
	if len(ca) == 0 && cluster.CertificateAuthority != "" {
		caPath := ExpandHomePath(cluster.CertificateAuthority)
		rawCA, err := os.ReadFile(caPath)
		if err != nil {
			return nil, fmt.Errorf("cannot read certificate-authority %q: %w", cluster.CertificateAuthority, err)
		}
		ca = rawCA
	}
	if decoded, err := base64.StdEncoding.DecodeString(string(ca)); err == nil && len(decoded) > 0 {
		ca = decoded
	}

	return &KubeconfigInfo{
		ClusterName: ctx.Cluster,
		DisplayName: ResolveKubeconfigDisplayName(apiConfig, contextName),
		Endpoint:    cluster.Server,
		CAData:      ca,
	}, nil
}

// resolveKubeconfigContext picks a context that still exists in the file.
// kubectl config delete-context leaves current-context pointing at the deleted
// name; client-go then fails every connect, not just that cluster.
func resolveKubeconfigContext(cfg *clientcmdapi.Config, requested string) (string, error) {
	if requested != "" {
		if _, ok := cfg.Contexts[requested]; ok {
			return requested, nil
		}
		return "", fmt.Errorf("context %q not found", requested)
	}
	if cfg.CurrentContext != "" {
		if _, ok := cfg.Contexts[cfg.CurrentContext]; ok {
			return cfg.CurrentContext, nil
		}
	}
	for name := range cfg.Contexts {
		return name, nil
	}
	return "", fmt.Errorf("kubeconfig has no contexts")
}

// KubeconfigToRestConfigWithContext builds a rest.Config using the specified context.
// If contextName is empty, the kubeconfig's current-context is used (or another
// remaining context if current-context is stale).
func KubeconfigToRestConfigWithContext(kubeconfigData, contextName string) (*rest.Config, error) {
	raw := []byte(kubeconfigData)
	apiConfig, err := clientcmd.Load(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid kubeconfig: %w", err)
	}

	contextName, err = resolveKubeconfigContext(apiConfig, contextName)
	if err != nil {
		return nil, err
	}
	// NewDefaultClientConfig uses file current-context in ConfirmUsable and
	// ignores overrides — a deleted current-context breaks every cluster.
	apiConfig.CurrentContext = contextName

	cfg, err := clientcmd.NewNonInteractiveClientConfig(*apiConfig, contextName, &clientcmd.ConfigOverrides{}, nil).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("build rest config: %w", err)
	}
	return cfg, nil
}

// ProbeKubeconfigAuth triggers the kubeconfig credential plugin (e.g. aws-vault)
// by calling the API server. Surfaces exec failures at connect time instead of
// later when the UI loads cluster data.
func ProbeKubeconfigAuth(ctx context.Context, cfg *rest.Config) error {
	client, err := clientset(cfg)
	if err != nil {
		return fmt.Errorf("create client: %w", err)
	}
	if _, err := client.Discovery().ServerVersion(); err != nil {
		return improveExecAuthError(err)
	}
	return nil
}

func improveExecAuthError(err error) error {
	msg := err.Error()
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "executable file not found") ||
		strings.Contains(lower, "no such file or directory"):
		return fmt.Errorf(
			"kubeconfig exec plugin failed — command not found on PATH "+
				"(aws-vault / aws / gcloud). Install it or ensure Homebrew paths are available. Details: %w",
			err,
		)
	case strings.Contains(lower, "aws-vault") || strings.Contains(lower, "getting credentials"):
		return fmt.Errorf(
			"kubeconfig exec plugin failed (aws-vault). "+
				"Unlock the vault / renew the session in a terminal first "+
				"(e.g. `aws-vault exec <profile> -- aws sts get-caller-identity`). Details: %w",
			err,
		)
	default:
		return fmt.Errorf("cluster auth failed: %w", err)
	}
}

// ExpandHomePath expands a leading "~/".
func ExpandHomePath(p string) string {
	if p == "" {
		return p
	}
	if p == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
		return p
	}
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

// ResolveKubeconfigYAML returns kubeconfig YAML for a profile.
// If meta.KubeconfigPath is set, the file is read from disk every time
// (live link to ~/.kube/config). Otherwise the embedded vault copy is used.
func ResolveKubeconfigYAML(meta ProfileMeta, cred StoredCredential) (string, error) {
	if meta.KubeconfigPath != "" {
		path, err := ValidateKubeconfigPath(meta.KubeconfigPath)
		if err != nil {
			return "", err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read kubeconfig %s: %w", path, err)
		}
		return string(raw), nil
	}
	if cred.KubeconfigData == "" {
		return "", fmt.Errorf("no kubeconfig data stored for profile %q", meta.Name)
	}
	return cred.KubeconfigData, nil
}

// KubeconfigPathCandidates returns likely kubeconfig files on this machine.
func KubeconfigPathCandidates() []string {
	var raw []string
	if v := os.Getenv("KUBECONFIG"); v != "" {
		for _, p := range strings.Split(v, string(os.PathListSeparator)) {
			if t := strings.TrimSpace(p); t != "" {
				raw = append(raw, t)
			}
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		raw = append(raw, filepath.Join(home, ".kube", "config"))
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(raw))
	for _, p := range raw {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// FindLiveKubeconfigPathForContext returns a validated path when contextName
// exists in a local kubeconfig file (~/.kube/config or KUBECONFIG).
func FindLiveKubeconfigPathForContext(contextName string) (string, bool) {
	if contextName == "" {
		return "", false
	}
	for _, candidate := range KubeconfigPathCandidates() {
		path, err := ValidateKubeconfigPath(candidate)
		if err != nil {
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		entries, err := ListKubeconfigContexts(string(raw))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.ContextName == contextName {
				return path, true
			}
		}
	}
	return "", false
}

// MatchKubeconfigContentToPath returns a validated path when content equals a
// local kubeconfig file byte-for-byte (ignoring trailing whitespace).
func MatchKubeconfigContentToPath(content string) (string, bool) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return "", false
	}
	for _, candidate := range KubeconfigPathCandidates() {
		path, err := ValidateKubeconfigPath(candidate)
		if err != nil {
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if strings.TrimSpace(string(raw)) == trimmed {
			return path, true
		}
	}
	return "", false
}

// UpgradeKubeconfigLiveLink switches an embedded profile to a live file link
// when its context exists in a local kubeconfig. Skips profiles the user
// explicitly imported as an embedded paste.
func UpgradeKubeconfigLiveLink(meta *ProfileMeta, cred *StoredCredential) bool {
	if meta.Type != "kubeconfig" || meta.KubeconfigPath != "" || meta.KubeconfigEmbedded {
		return false
	}
	path, ok := FindLiveKubeconfigPathForContext(meta.ClusterName)
	if !ok {
		return false
	}
	meta.KubeconfigPath = path
	meta.KubeconfigEmbedded = false
	cred.KubeconfigData = ""
	return true
}
