package services

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// EnrichPATH prepends common user/tool locations so kubeconfig exec plugins
// (aws-vault, aws, gcloud, …) are found when the process was started from a
// macOS GUI app with a stripped PATH.
func EnrichPATH() {
	home, _ := os.UserHomeDir()
	extras := []string{
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/local/sbin",
	}
	if home != "" {
		extras = append(extras,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, "bin"),
			filepath.Join(home, ".aws-vault"),
		)
	}

	existing := strings.Split(os.Getenv("PATH"), string(os.PathListSeparator))
	seen := map[string]bool{}
	var parts []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		parts = append(parts, p)
	}
	for _, p := range extras {
		add(p)
	}
	for _, p := range existing {
		add(p)
	}
	_ = os.Setenv("PATH", strings.Join(parts, string(os.PathListSeparator)))

	// aws CLI / aws-vault often need HOME for config + macOS keychain.
	if os.Getenv("HOME") == "" && home != "" {
		_ = os.Setenv("HOME", home)
	}

	// GUI / non-TTY: prefer macOS dialog prompts for aws-vault MFA/keychain.
	if runtime.GOOS == "darwin" && os.Getenv("AWS_VAULT_PROMPT") == "" {
		_ = os.Setenv("AWS_VAULT_PROMPT", "osascript")
	}
}
