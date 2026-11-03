package services

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
)

// AllowedExecShells is the server-side allowlist for pod exec.
var AllowedExecShells = map[string]bool{
	"/bin/bash": true,
	"/bin/sh":   true,
	"/bin/ash":  true,
	"bash":      true,
	"sh":        true,
	"ash":       true,
}

// NormalizeExecShell returns an allowed shell path or an error.
func NormalizeExecShell(shell string) (string, error) {
	s := strings.TrimSpace(shell)
	if s == "" {
		return "/bin/sh", nil
	}
	if !AllowedExecShells[s] {
		return "", fmt.Errorf("shell not allowed: %q", shell)
	}
	switch s {
	case "bash":
		return "/bin/bash", nil
	case "sh":
		return "/bin/sh", nil
	case "ash":
		return "/bin/ash", nil
	default:
		return s, nil
	}
}

// KubeconfigExecCommands lists distinct exec plugin commands in the kubeconfig.
func KubeconfigExecCommands(yaml string) ([]string, error) {
	apiConfig, err := clientcmd.Load([]byte(yaml))
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(cmd string) {
		cmd = strings.TrimSpace(cmd)
		if cmd == "" {
			return
		}
		if _, ok := seen[cmd]; ok {
			return
		}
		seen[cmd] = struct{}{}
		out = append(out, cmd)
	}
	for _, auth := range apiConfig.AuthInfos {
		if auth == nil || auth.Exec == nil {
			continue
		}
		add(auth.Exec.Command)
	}
	return out, nil
}

// KubeconfigInsecureTLS reports whether the selected (or current) cluster
// skips TLS verification.
func KubeconfigInsecureTLS(yaml, contextName string) (bool, string, error) {
	apiConfig, err := clientcmd.Load([]byte(yaml))
	if err != nil {
		return false, "", err
	}
	ctxName, err := resolveKubeconfigContext(apiConfig, contextName)
	if err != nil {
		return false, "", err
	}
	ctx, ok := apiConfig.Contexts[ctxName]
	if !ok || ctx == nil {
		return false, "", fmt.Errorf("context %q not found", ctxName)
	}
	cluster, ok := apiConfig.Clusters[ctx.Cluster]
	if !ok || cluster == nil {
		return false, "", fmt.Errorf("cluster %q not found", ctx.Cluster)
	}
	return cluster.InsecureSkipTLSVerify, cluster.Server, nil
}

// ValidateKubeconfigPath expands ~, cleans the path, and requires it to live
// under the user's home directory (blocks arbitrary filesystem reads).
func ValidateKubeconfigPath(p string) (string, error) {
	if strings.TrimSpace(p) == "" {
		return "", fmt.Errorf("kubeconfig path is empty")
	}
	expanded := ExpandHomePath(p)
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory")
	}
	home, err = filepath.Abs(home)
	if err != nil {
		return "", err
	}
	home = filepath.Clean(home)
	rel, err := filepath.Rel(home, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("kubeconfig path must be under your home directory")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("cannot read kubeconfig file: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("kubeconfig path is a directory")
	}
	return abs, nil
}

// EnsureDataDirSafe creates the data directory and refuses world-writable paths
// on Unix. On Windows, FileMode bits from os.Stat are not meaningful ACL
// security (AppData dirs often appear "world-writable") — skip that check.
func EnsureDataDirSafe() error {
	dir := DataDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0002 != 0 {
		return fmt.Errorf("data directory is world-writable: %s", dir)
	}
	return nil
}
