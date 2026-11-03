package services

import (
	"log"
	"os"
	"sort"
	"sync"

	"github.com/google/uuid"
	"k8s.io/client-go/tools/clientcmd"
)

var liveKubeSyncMu sync.Mutex

// HasLiveKubeconfigProfiles is true when at least one profile is live-linked to a
// kubeconfig file. Dynamic sync must not run otherwise: we never scan
// ~/.kube/config just because it exists.
func HasLiveKubeconfigProfiles(cfg *AppConfig) bool {
	if cfg == nil {
		return false
	}
	for _, p := range cfg.Profiles {
		if isLiveKubeconfigProfile(p) {
			return true
		}
	}
	return false
}

func isLiveKubeconfigProfile(p ProfileMeta) bool {
	return p.Type == "kubeconfig" && p.KubeconfigPath != "" && !p.KubeconfigEmbedded
}

// SyncLiveKubeconfigProfiles makes live-linked kubeconfig profiles match the
// file: new contexts become profiles, missing contexts are deleted.
// No-op if the user never imported a kubeconfig file, or deleted every
// live-linked kubeconfig profile from the app (pasted YAML does not count).
func SyncLiveKubeconfigProfiles() []string {
	liveKubeSyncMu.Lock()
	defer liveKubeSyncMu.Unlock()

	cfg, err := LoadAppConfig()
	if err != nil {
		log.Printf("live kubeconfig sync: load config: %v", err)
		return nil
	}
	if !HasLiveKubeconfigProfiles(cfg) {
		if len(cfg.KubeconfigDeferred) > 0 {
			cfg.KubeconfigDeferred = nil
			if err := SaveAppConfig(cfg); err != nil {
				log.Printf("live kubeconfig sync: clear deferred: %v", err)
			}
		}
		return nil
	}

	byPath := map[string][]ProfileMeta{}
	for _, p := range cfg.Profiles {
		if !isLiveKubeconfigProfile(p) {
			continue
		}
		byPath[p.KubeconfigPath] = append(byPath[p.KubeconfigPath], p)
	}

	var removed []string
	changed := false
	for path, existing := range byPath {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		contexts, err := kubeconfigContextNames(raw)
		if err != nil {
			log.Printf("live kubeconfig sync: parse %s: %v", path, err)
			continue
		}
		toAdd, toRemove := diffLiveKubeProfiles(existing, contexts)
		imported := map[string]struct{}{}
		for _, p := range existing {
			if p.ClusterName != "" {
				imported[p.ClusterName] = struct{}{}
			}
		}
		if ensureDeferredSnapshot(cfg, path, contexts, imported) {
			changed = true
		}
		toAdd = subtractDeferred(toAdd, cfg.KubeconfigDeferred[path])
		inherit := existing[0]
		for _, p := range toRemove {
			delete(cfg.Profiles, p.Name)
			_ = DeleteCredential(p.Name)
			removed = append(removed, p.Name)
			changed = true
		}
		for _, ctx := range toAdd {
			name := uuid.New().String()
			if err := SaveCredential(name, StoredCredential{Type: "kubeconfig"}); err != nil {
				log.Printf("live kubeconfig sync: save cred %s: %v", ctx, err)
				continue
			}
			cfg.Profiles[name] = ProfileMeta{
				Name:               name,
				Type:               "kubeconfig",
				ClusterName:        ctx,
				Group:              inherit.Group,
				KubeconfigPath:     path,
				KubeconfigEmbedded: false,
				AllowExec:          inherit.AllowExec,
				AllowInsecureTLS:   inherit.AllowInsecureTLS,
			}
			changed = true
		}
	}
	pruneKubeconfigDeferred(cfg)
	if changed {
		if err := SaveAppConfig(cfg); err != nil {
			log.Printf("live kubeconfig sync: save config: %v", err)
		}
	}
	return removed
}

func kubeconfigContextNames(data []byte) ([]string, error) {
	cfg, err := clientcmd.Load(data)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(cfg.Contexts))
	for name := range cfg.Contexts {
		if name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names, nil
}

func diffLiveKubeProfiles(existing []ProfileMeta, contexts []string) (toAdd []string, toRemove []ProfileMeta) {
	want := make(map[string]struct{}, len(contexts))
	for _, c := range contexts {
		if c != "" {
			want[c] = struct{}{}
		}
	}
	have := make(map[string]ProfileMeta, len(existing))
	for _, p := range existing {
		if p.ClusterName == "" {
			continue
		}
		have[p.ClusterName] = p
	}
	for ctx := range want {
		if _, ok := have[ctx]; !ok {
			toAdd = append(toAdd, ctx)
		}
	}
	sort.Strings(toAdd)
	for ctx, p := range have {
		if _, ok := want[ctx]; !ok {
			toRemove = append(toRemove, p)
		}
	}
	sort.Slice(toRemove, func(i, j int) bool { return toRemove[i].Name < toRemove[j].Name })
	return toAdd, toRemove
}

func subtractDeferred(toAdd, deferred []string) []string {
	if len(deferred) == 0 || len(toAdd) == 0 {
		return toAdd
	}
	skip := make(map[string]struct{}, len(deferred))
	for _, d := range deferred {
		skip[d] = struct{}{}
	}
	out := toAdd[:0]
	for _, ctx := range toAdd {
		if _, ok := skip[ctx]; !ok {
			out = append(out, ctx)
		}
	}
	return out
}

func importedContextsForPath(cfg *AppConfig, path string) map[string]struct{} {
	out := map[string]struct{}{}
	if cfg == nil {
		return out
	}
	for _, p := range cfg.Profiles {
		if isLiveKubeconfigProfile(p) && p.KubeconfigPath == path && p.ClusterName != "" {
			out[p.ClusterName] = struct{}{}
		}
	}
	return out
}

// ensureDeferredSnapshot records contexts that were already in the file but not
// imported. Returns true if cfg was mutated. No-op if this path was snapshotted.
func ensureDeferredSnapshot(cfg *AppConfig, path string, fileContexts []string, imported map[string]struct{}) bool {
	if cfg.KubeconfigDeferred == nil {
		cfg.KubeconfigDeferred = map[string][]string{}
	}
	if _, ok := cfg.KubeconfigDeferred[path]; ok {
		return false
	}
	var def []string
	for _, ctx := range fileContexts {
		if _, have := imported[ctx]; !have {
			def = append(def, ctx)
		}
	}
	sort.Strings(def)
	cfg.KubeconfigDeferred[path] = def
	return true
}

func skipLiveKubeconfigContext(cfg *AppConfig, path, contextName string) bool {
	if path == "" || contextName == "" {
		return false
	}
	if cfg.KubeconfigDeferred == nil {
		cfg.KubeconfigDeferred = map[string][]string{}
	}
	for _, d := range cfg.KubeconfigDeferred[path] {
		if d == contextName {
			return false
		}
	}
	cfg.KubeconfigDeferred[path] = append(cfg.KubeconfigDeferred[path], contextName)
	sort.Strings(cfg.KubeconfigDeferred[path])
	return true
}

// deferLiveKubeconfigContext records a manually removed context so sync will not
// recreate it. If this path has no snapshot yet, every other file context that
// is not currently imported is snapshotted too.
func deferLiveKubeconfigContext(cfg *AppConfig, path, contextName string) {
	if cfg == nil || path == "" || contextName == "" {
		return
	}
	imported := importedContextsForPath(cfg, path)
	delete(imported, contextName)
	var fileContexts []string
	if raw, err := os.ReadFile(path); err == nil {
		fileContexts, _ = kubeconfigContextNames(raw)
	}
	ensureDeferredSnapshot(cfg, path, fileContexts, imported)
	skipLiveKubeconfigContext(cfg, path, contextName)
}

func unskipDeferred(cfg *AppConfig, path, contextName string) bool {
	if cfg.KubeconfigDeferred == nil {
		return false
	}
	cur, ok := cfg.KubeconfigDeferred[path]
	if !ok {
		return false
	}
	next := cur[:0]
	changed := false
	for _, d := range cur {
		if d == contextName {
			changed = true
			continue
		}
		next = append(next, d)
	}
	if !changed {
		return false
	}
	if len(next) == 0 {
		cfg.KubeconfigDeferred[path] = []string{}
	} else {
		cfg.KubeconfigDeferred[path] = append([]string(nil), next...)
	}
	return true
}

func pruneKubeconfigDeferred(cfg *AppConfig) {
	if cfg == nil || cfg.KubeconfigDeferred == nil {
		return
	}
	live := map[string]struct{}{}
	for _, p := range cfg.Profiles {
		if isLiveKubeconfigProfile(p) {
			live[p.KubeconfigPath] = struct{}{}
		}
	}
	for path := range cfg.KubeconfigDeferred {
		if _, ok := live[path]; !ok {
			delete(cfg.KubeconfigDeferred, path)
		}
	}
}

// AdoptLiveKubeconfigContext marks a context as intentionally imported from a
// live-linked file. First import of the path snapshots every other context
// already in the file as deferred (not auto-added). Later manual imports
// remove the context from that deferred list.
func AdoptLiveKubeconfigContext(path, contextName string) error {
	if path == "" || contextName == "" {
		return nil
	}
	liveKubeSyncMu.Lock()
	defer liveKubeSyncMu.Unlock()

	cfg, err := LoadAppConfig()
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	fileContexts, err := kubeconfigContextNames(raw)
	if err != nil {
		return err
	}
	imported := importedContextsForPath(cfg, path)
	changed := ensureDeferredSnapshot(cfg, path, fileContexts, imported)
	if unskipDeferred(cfg, path, contextName) {
		changed = true
	}
	if !changed {
		return nil
	}
	return SaveAppConfig(cfg)
}

// UnlinkLiveKubeconfig removes every live-linked profile for path (empty path =
// all live kubeconfig files) and stops watching. Contexts are not re-imported
// until the user adds the file again.
func UnlinkLiveKubeconfig(path string) ([]string, error) {
	liveKubeSyncMu.Lock()
	defer liveKubeSyncMu.Unlock()

	cfg, err := LoadAppConfig()
	if err != nil {
		return nil, err
	}
	var removed []string
	for name, p := range cfg.Profiles {
		if !isLiveKubeconfigProfile(p) {
			continue
		}
		if path != "" && p.KubeconfigPath != path {
			continue
		}
		delete(cfg.Profiles, name)
		_ = DeleteCredential(name)
		removed = append(removed, name)
	}
	sort.Strings(removed)
	if path == "" {
		cfg.KubeconfigDeferred = nil
	} else if cfg.KubeconfigDeferred != nil {
		delete(cfg.KubeconfigDeferred, path)
	}
	pruneKubeconfigDeferred(cfg)
	if err := SaveAppConfig(cfg); err != nil {
		return removed, err
	}
	return removed, nil
}
