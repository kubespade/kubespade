package services

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// DataDir returns the directory used to store application data (config, credentials).
// Priority: K8S_CLIENT_DATA env → OS app-data dir → /data (Docker fallback).
func DataDir() string {
	if d := os.Getenv("K8S_CLIENT_DATA"); d != "" {
		return d
	}
	switch runtime.GOOS {
	case "darwin":
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, "Library", "Application Support", "KubeSpade")
		}
	case "windows":
		if cfg, err := os.UserConfigDir(); err == nil {
			return filepath.Join(cfg, "KubeSpade")
		}
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, "AppData", "Roaming", "KubeSpade")
		}
	default:
		// Linux desktop: ~/.config/KubeSpade
		if cfg, err := os.UserConfigDir(); err == nil {
			return filepath.Join(cfg, "KubeSpade")
		}
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".config", "KubeSpade")
		}
	}
	return "/data"
}

// legacyDataDirNames are previous Application Support / config folder names.
// Prefer the most recent brand first when choosing a migration source.
var legacyDataDirNames = []string{"K8s Client", "K8s Flashlight", "k8s-flashlight"}

var migrateDataFiles = []string{
	"app-config.json",
	"credentials.enc",
	"sessions.enc",
	"ui-prefs.json",
	".vault-pass",
}

// MigrateLegacyDataDir copies app data from an older brand folder into DataDir
// when the new directory has no credentials yet. Safe to call on every start.
func MigrateLegacyDataDir() {
	if os.Getenv("K8S_CLIENT_DATA") != "" {
		return
	}
	dst := DataDir()
	if hasAppData(dst) {
		return
	}
	src := findLegacyDataDir()
	if src == "" || src == dst {
		return
	}
	_ = os.MkdirAll(dst, 0700)
	for _, name := range migrateDataFiles {
		from := filepath.Join(src, name)
		to := filepath.Join(dst, name)
		if _, err := os.Stat(to); err == nil {
			continue
		}
		if err := copyFile(from, to); err != nil {
			continue
		}
	}
}

func findLegacyDataDir() string {
	var bases []string
	switch runtime.GOOS {
	case "darwin":
		if home, err := os.UserHomeDir(); err == nil {
			bases = append(bases, filepath.Join(home, "Library", "Application Support"))
		}
	case "windows":
		if cfg, err := os.UserConfigDir(); err == nil {
			bases = append(bases, cfg)
		}
	default:
		if cfg, err := os.UserConfigDir(); err == nil {
			bases = append(bases, cfg)
		}
	}
	for _, base := range bases {
		for _, name := range legacyDataDirNames {
			dir := filepath.Join(base, name)
			if hasAppData(dir) {
				return dir
			}
		}
	}
	return ""
}

func hasAppData(dir string) bool {
	for _, name := range []string{"credentials.enc", "app-config.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	mode := info.Mode().Perm() | 0600
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
