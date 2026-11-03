package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

func uiPrefsPath() string { return filepath.Join(DataDir(), "ui-prefs.json") }

var (
	uiPrefsMu sync.Mutex
)

// LoadUIPrefs returns persisted UI preferences (column layouts, scale, etc.).
func LoadUIPrefs() (map[string]string, error) {
	uiPrefsMu.Lock()
	defer uiPrefsMu.Unlock()
	data, err := os.ReadFile(uiPrefsPath())
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var prefs map[string]string
	if err := json.Unmarshal(data, &prefs); err != nil {
		return nil, err
	}
	if prefs == nil {
		prefs = map[string]string{}
	}
	return prefs, nil
}

// MergeUIPrefs overlays updates onto the existing prefs and removes keys in remove.
func MergeUIPrefs(updates map[string]string, remove []string) (map[string]string, error) {
	uiPrefsMu.Lock()
	defer uiPrefsMu.Unlock()

	prefs := map[string]string{}
	if data, err := os.ReadFile(uiPrefsPath()); err == nil {
		_ = json.Unmarshal(data, &prefs)
		if prefs == nil {
			prefs = map[string]string{}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	for _, k := range remove {
		delete(prefs, k)
	}
	for k, v := range updates {
		prefs[k] = v
	}

	if err := os.MkdirAll(filepath.Dir(uiPrefsPath()), 0700); err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(uiPrefsPath(), data, 0600); err != nil {
		return nil, err
	}
	return prefs, nil
}
