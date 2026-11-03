package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// AIClusterEntry is one context exposed to the Claude workspace.
type AIClusterEntry struct {
	Context string `json:"context"`
	Profile string `json:"profile"`
	Label   string `json:"label"`
}

// AIWorkspaceResult describes the ephemeral AI workspace on disk.
type AIWorkspaceResult struct {
	Path            string           `json:"path"`
	Kubeconfig      string           `json:"kubeconfig"`      // live config for MCP only
	ShellKubeconfig string           `json:"shellKubeconfig"` // empty config for AI PTY
	ClusterCount    int              `json:"clusterCount"`
	Clusters        []AIClusterEntry `json:"clusters"`
}

var aiContextSafe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// AIWorkspaceDir is the ephemeral AI cwd (docs, empty shell kubeconfig, MCP client configs).
func AIWorkspaceDir() string {
	return filepath.Join(DataDir(), "ai-workspace")
}

// AISecretsDir holds the live multi-context kubeconfig used only by the MCP server.
// Kept outside the AI cwd so the model cannot trivially export it from the shell.
func AISecretsDir() string {
	return filepath.Join(DataDir(), "ai-secrets")
}

// AIKubeconfigPath is the live kubeconfig path for MCP (not for the AI shell).
func AIKubeconfigPath() string {
	return filepath.Join(AISecretsDir(), "kubeconfig")
}

// AIShellKubeconfigPath is an empty kubeconfig forced into the AI PTY so kubectl
// does not fall back to ~/.kube/config.
func AIShellKubeconfigPath() string {
	return filepath.Join(AIWorkspaceDir(), "kubeconfig.empty")
}

// SanitizeAIContext turns a profile name into a kubectl context name.
func SanitizeAIContext(profile string) string {
	s := strings.TrimSpace(profile)
	s = aiContextSafe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-._")
	if s == "" {
		s = "cluster"
	}
	if len(s) > 48 {
		s = s[:48]
	}
	return s
}

// RestConfigToNamedContext adds one cluster/auth/context into cfg.
func RestConfigToNamedContext(apiCfg *clientcmdapi.Config, contextName string, rc *rest.Config) error {
	if rc == nil {
		return fmt.Errorf("nil rest config")
	}
	clusterKey := "cluster-" + contextName
	userKey := "user-" + contextName

	cluster := &clientcmdapi.Cluster{
		Server:                   rc.Host,
		InsecureSkipTLSVerify:    rc.Insecure,
		CertificateAuthorityData: append([]byte(nil), rc.CAData...),
	}
	if rc.CAFile != "" && len(cluster.CertificateAuthorityData) == 0 {
		cluster.CertificateAuthority = rc.CAFile
	}
	apiCfg.Clusters[clusterKey] = cluster

	auth := &clientcmdapi.AuthInfo{
		Token:                 rc.BearerToken,
		TokenFile:             rc.BearerTokenFile,
		ClientCertificateData: append([]byte(nil), rc.CertData...),
		ClientKeyData:         append([]byte(nil), rc.KeyData...),
	}
	if rc.CertFile != "" && len(auth.ClientCertificateData) == 0 {
		auth.ClientCertificate = rc.CertFile
	}
	if rc.KeyFile != "" && len(auth.ClientKeyData) == 0 {
		auth.ClientKey = rc.KeyFile
	}
	if rc.Username != "" {
		auth.Username = rc.Username
		auth.Password = rc.Password
	}
	// Live-linked kubeconfigs often use exec (aws eks get-token, gcloud, kubelogin).
	// Without copying Exec, kubectl falls back to interactive "Please enter Username".
	if rc.ExecProvider != nil {
		auth.Exec = rc.ExecProvider.DeepCopy()
	}
	hasCreds := auth.Token != "" || auth.TokenFile != "" ||
		len(auth.ClientCertificateData) > 0 || auth.ClientCertificate != "" ||
		auth.Exec != nil || auth.Username != ""
	if !hasCreds {
		return fmt.Errorf("no credentials in rest config for context %s", contextName)
	}
	apiCfg.AuthInfos[userKey] = auth

	apiCfg.Contexts[contextName] = &clientcmdapi.Context{
		Cluster:  clusterKey,
		AuthInfo: userKey,
	}
	return nil
}

func buildIdentityMD(clusters []AIClusterEntry) string {
	var b strings.Builder
	b.WriteString("# KubeSpade — in-app AI assistant\n\n")
	b.WriteString("You are the **KubeSpade** desktop assistant (not a generic coding CLI).\n")
	b.WriteString("The user opened this panel inside KubeSpade to work with their Kubernetes clusters.\n\n")
	b.WriteString("## How to work\n\n")
	b.WriteString("- Use the **KubeSpade cluster tools** (`kubespade_list_clusters`, `kubespade_get`, `kubespade_describe`, `kubespade_logs`, `kubespade_apply`, `kubespade_delete`) for all cluster access.\n")
	b.WriteString("- **Never run `kubectl` in this shell** — it is not on PATH and has no credentials. If a cluster tool errors, tell the user that error; do not fall back to kubectl.\n")
	b.WriteString("- Cluster warnings: `kubespade_get` with resource `events` (optional fieldSelector `type=Warning`).\n")
	b.WriteString("- You only see clusters **currently connected in the app**.\n")
	b.WriteString("- **Reads** (list/get/describe/logs): call the tools freely.\n")
	b.WriteString("- **Writes** (apply/delete): use the write tools — KubeSpade will ask the user to Approve/Deny in the app UI.\n")
	b.WriteString("- **Deletes of several objects:** one `kubespade_delete` with `items: [{resource, name, namespace?}, …]` so the user Approves once. Do not call delete once per object.\n")
	b.WriteString("- If several clusters could apply, **ask which context** before assuming or mutating.\n")
	b.WriteString("- For unrestricted kubectl against other kubeconfigs, the user should use an external terminal.\n")
	b.WriteString("- You may also answer general (non-cluster) questions.\n")
	b.WriteString("- Speak to the user in plain product language (clusters, pods, apply). Do not discuss protocol plumbing.\n\n")

	if len(clusters) == 0 {
		b.WriteString("## Clusters\n\n")
		b.WriteString("**No clusters are connected in KubeSpade right now.**\n")
		b.WriteString("Do not invent cluster state. Tell the user to connect a cluster in the app (Manage / Connect),\n")
		b.WriteString("then reopen this AI panel so context is refreshed.\n")
		return b.String()
	}

	b.WriteString("## Connected clusters\n\n")
	b.WriteString("| Context | Profile | Label |\n|---|---|---|\n")
	for _, c := range clusters {
		fmt.Fprintf(&b, "| `%s` | `%s` | %s |\n", c.Context, c.Profile, c.Label)
	}
	return b.String()
}

// WriteAIWorkspace builds kubeconfig + identity docs for the given rest configs.
// The workspace directory is kept stable across sessions so CLI auth caches
// (e.g. Gemini under .gemini/) survive; only secrets are rotated.
// restByProfile maps profile name → live rest.Config (already refreshed).
// labels maps profile → display label.
func WriteAIWorkspace(restByProfile map[string]*rest.Config, labels map[string]string) (*AIWorkspaceResult, error) {
	dir := AIWorkspaceDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}

	apiCfg := clientcmdapi.NewConfig()
	used := map[string]int{}
	var clusters []AIClusterEntry

	names := make([]string, 0, len(restByProfile))
	for n := range restByProfile {
		names = append(names, n)
	}
	sort.Strings(names)

	for _, profile := range names {
		rc := restByProfile[profile]
		base := SanitizeAIContext(profile)
		ctxName := base
		if n := used[base]; n > 0 {
			ctxName = fmt.Sprintf("%s-%d", base, n+1)
		}
		used[base]++

		if err := RestConfigToNamedContext(apiCfg, ctxName, rc); err != nil {
			continue
		}
		label := labels[profile]
		if label == "" {
			label = profile
		}
		clusters = append(clusters, AIClusterEntry{
			Context: ctxName,
			Profile: profile,
			Label:   label,
		})
	}

	if len(clusters) > 0 {
		apiCfg.CurrentContext = clusters[0].Context
	}

	secretsDir := AISecretsDir()
	if err := os.RemoveAll(secretsDir); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(secretsDir, 0o700); err != nil {
		return nil, err
	}
	kcPath := AIKubeconfigPath()
	if err := clientcmd.WriteToFile(*apiCfg, kcPath); err != nil {
		return nil, err
	}
	_ = os.Chmod(kcPath, 0o600)

	// Empty kubeconfig for the AI shell — blocks ~/.kube/config fallback.
	emptyCfg := clientcmdapi.NewConfig()
	shellKC := AIShellKubeconfigPath()
	if err := clientcmd.WriteToFile(*emptyCfg, shellKC); err != nil {
		return nil, err
	}
	_ = os.Chmod(shellKC, 0o600)

	identity := buildIdentityMD(clusters)
	for _, name := range []string{"CLAUDE.md", "AGENTS.md", "GEMINI.md", "COPILOT.md", "CURSOR.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(identity), 0o600); err != nil {
			return nil, err
		}
	}

	clustersJSON, err := json.MarshalIndent(clusters, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "clusters.json"), clustersJSON, 0o600); err != nil {
		return nil, err
	}

	return &AIWorkspaceResult{
		Path:            dir,
		Kubeconfig:      kcPath,
		ShellKubeconfig: shellKC,
		ClusterCount:    len(clusters),
		Clusters:        clusters,
	}, nil
}

// ClearAIWorkspace wipes live cluster credentials. Keeps the stable AI workspace
// dir (CLI login caches under .gemini / .claude / .codex / .cursor; Copilot auth lives in ~/.copilot).
func ClearAIWorkspace() error {
	if err := os.RemoveAll(AISecretsDir()); err != nil && !os.IsNotExist(err) {
		return err
	}
	if dir := AIWorkspaceDir(); dir != "" {
		_ = os.Remove(filepath.Join(dir, "clusters.json"))
		shellKC := AIShellKubeconfigPath()
		if err := os.MkdirAll(dir, 0o700); err == nil {
			_ = clientcmd.WriteToFile(*clientcmdapi.NewConfig(), shellKC)
			_ = os.Chmod(shellKC, 0o600)
		}
	}
	return nil
}
