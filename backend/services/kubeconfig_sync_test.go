package services

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiffLiveKubeProfiles_addAndRemove(t *testing.T) {
	existing := []ProfileMeta{
		{Name: "a", ClusterName: "keep"},
		{Name: "b", ClusterName: "gone"},
	}
	add, remove := diffLiveKubeProfiles(existing, []string{"keep", "new-aks"})
	if len(add) != 1 || add[0] != "new-aks" {
		t.Fatalf("add: %v", add)
	}
	if len(remove) != 1 || remove[0].Name != "b" {
		t.Fatalf("remove: %+v", remove)
	}
}

func TestDiffLiveKubeProfiles_emptyFileRemovesAll(t *testing.T) {
	existing := []ProfileMeta{
		{Name: "a", ClusterName: "one"},
		{Name: "b", ClusterName: "two"},
	}
	add, remove := diffLiveKubeProfiles(existing, nil)
	if len(add) != 0 {
		t.Fatalf("add: %v", add)
	}
	if len(remove) != 2 {
		t.Fatalf("remove: %+v", remove)
	}
}

func TestDiffLiveKubeProfiles_skipsUnpinned(t *testing.T) {
	existing := []ProfileMeta{
		{Name: "orphan", ClusterName: ""},
		{Name: "pinned", ClusterName: "ctx"},
	}
	add, remove := diffLiveKubeProfiles(existing, []string{"ctx"})
	if len(add) != 0 || len(remove) != 0 {
		t.Fatalf("add=%v remove=%+v", add, remove)
	}
}

func TestKubeconfigContextNames_empty(t *testing.T) {
	names, err := kubeconfigContextNames([]byte(`apiVersion: v1
kind: Config
clusters: []
contexts: []
users: []
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 0 {
		t.Fatalf("names: %v", names)
	}
}

func TestHasLiveKubeconfigProfiles(t *testing.T) {
	if HasLiveKubeconfigProfiles(&AppConfig{Profiles: map[string]ProfileMeta{}}) {
		t.Fatal("empty config")
	}
	if HasLiveKubeconfigProfiles(&AppConfig{Profiles: map[string]ProfileMeta{
		"aws":   {Name: "aws", Type: "aws"},
		"paste": {Name: "paste", Type: "kubeconfig", KubeconfigEmbedded: true, ClusterName: "ctx"},
	}}) {
		t.Fatal("aws + pasted kubeconfig must not enable live sync")
	}
	if !HasLiveKubeconfigProfiles(&AppConfig{Profiles: map[string]ProfileMeta{
		"live": {Name: "live", Type: "kubeconfig", KubeconfigPath: "/tmp/config", ClusterName: "ctx"},
	}}) {
		t.Fatal("live-linked profile should enable sync")
	}
}

func TestSyncLiveKubeconfigProfiles_noopWithoutLiveProfiles(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)
	kube := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(kube, []byte(`apiVersion: v1
kind: Config
clusters:
- name: aks
  cluster:
    server: https://aks.example
contexts:
- name: kubespade-test-aks
  context:
    cluster: aks
    user: u
users:
- name: u
  user:
    token: x
`), 0600); err != nil {
		t.Fatal(err)
	}
	removed := SyncLiveKubeconfigProfiles()
	if len(removed) != 0 {
		t.Fatalf("removed: %v", removed)
	}
	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Profiles) != 0 {
		t.Fatalf("sync imported profiles without a live-linked import: %+v", cfg.Profiles)
	}
}

func TestSubtractDeferred(t *testing.T) {
	got := subtractDeferred([]string{"new", "skipped", "also-new"}, []string{"skipped"})
	if len(got) != 2 || got[0] != "new" || got[1] != "also-new" {
		t.Fatalf("got %v", got)
	}
}

func TestEnsureDeferredSnapshot_onlyOnce(t *testing.T) {
	cfg := &AppConfig{}
	imported := map[string]struct{}{"keep": {}}
	if !ensureDeferredSnapshot(cfg, "/kube", []string{"keep", "skip-me"}, imported) {
		t.Fatal("first snapshot should mutate")
	}
	if len(cfg.KubeconfigDeferred["/kube"]) != 1 || cfg.KubeconfigDeferred["/kube"][0] != "skip-me" {
		t.Fatalf("deferred: %v", cfg.KubeconfigDeferred["/kube"])
	}
	if ensureDeferredSnapshot(cfg, "/kube", []string{"keep", "skip-me", "brand-new"}, imported) {
		t.Fatal("second snapshot must not reset")
	}
	if len(cfg.KubeconfigDeferred["/kube"]) != 1 {
		t.Fatalf("brand-new must not be deferred: %v", cfg.KubeconfigDeferred["/kube"])
	}
}

func TestUnskipDeferred(t *testing.T) {
	cfg := &AppConfig{KubeconfigDeferred: map[string][]string{"/kube": {"a", "b"}}}
	if !unskipDeferred(cfg, "/kube", "a") {
		t.Fatal("expected change")
	}
	if len(cfg.KubeconfigDeferred["/kube"]) != 1 || cfg.KubeconfigDeferred["/kube"][0] != "b" {
		t.Fatalf("got %v", cfg.KubeconfigDeferred["/kube"])
	}
}

func TestPruneKubeconfigDeferred(t *testing.T) {
	cfg := &AppConfig{
		Profiles: map[string]ProfileMeta{
			"aws": {Name: "aws", Type: "aws"},
		},
		KubeconfigDeferred: map[string][]string{"/kube": {"x"}},
	}
	pruneKubeconfigDeferred(cfg)
	if _, ok := cfg.KubeconfigDeferred["/kube"]; ok {
		t.Fatal("deferred must clear when no live-linked profiles remain")
	}
}

func kubeconfigYAML(contexts ...string) string {
	s := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://example\nusers:\n- name: u\n  user:\n    token: x\ncontexts:\n"
	for _, ctx := range contexts {
		s += "- name: " + ctx + "\n  context:\n    cluster: c\n    user: u\n"
	}
	return s
}

func TestSyncLiveKubeconfigProfiles_skipsDeferredUntilManual(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)
	kube := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(kube, []byte(kubeconfigYAML("keep", "skipped")), 0600); err != nil {
		t.Fatal(err)
	}
	if err := SaveCredential("keep-id", StoredCredential{Type: "kubeconfig"}); err != nil {
		t.Fatal(err)
	}
	if err := SaveProfile(ProfileMeta{
		Name:           "keep-id",
		Type:           "kubeconfig",
		ClusterName:    "keep",
		KubeconfigPath: kube,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdoptLiveKubeconfigContext(kube, "keep"); err != nil {
		t.Fatal(err)
	}

	SyncLiveKubeconfigProfiles()
	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Profiles) != 1 {
		t.Fatalf("skipped context must not be auto-imported: %+v", cfg.Profiles)
	}
	if len(cfg.KubeconfigDeferred[kube]) != 1 || cfg.KubeconfigDeferred[kube][0] != "skipped" {
		t.Fatalf("deferred: %v", cfg.KubeconfigDeferred[kube])
	}

	if err := os.WriteFile(kube, []byte(kubeconfigYAML("keep", "skipped", "brand-new")), 0600); err != nil {
		t.Fatal(err)
	}
	SyncLiveKubeconfigProfiles()
	cfg, err = LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]struct{}{}
	for _, p := range cfg.Profiles {
		names[p.ClusterName] = struct{}{}
	}
	if _, ok := names["brand-new"]; !ok {
		t.Fatalf("new context should be auto-added: %+v", cfg.Profiles)
	}
	if _, ok := names["skipped"]; ok {
		t.Fatalf("deferred context still must not be auto-added: %+v", cfg.Profiles)
	}

	if err := SaveCredential("skip-id", StoredCredential{Type: "kubeconfig"}); err != nil {
		t.Fatal(err)
	}
	if err := SaveProfile(ProfileMeta{
		Name:           "skip-id",
		Type:           "kubeconfig",
		ClusterName:    "skipped",
		KubeconfigPath: kube,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdoptLiveKubeconfigContext(kube, "skipped"); err != nil {
		t.Fatal(err)
	}
	cfg, err = LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range cfg.KubeconfigDeferred[kube] {
		if d == "skipped" {
			t.Fatal("manual add must unskip deferred context")
		}
	}
}

func seedLiveKubeProfile(t *testing.T, id, ctx, kube string) {
	t.Helper()
	if err := SaveCredential(id, StoredCredential{Type: "kubeconfig"}); err != nil {
		t.Fatal(err)
	}
	if err := SaveProfile(ProfileMeta{
		Name:           id,
		Type:           "kubeconfig",
		ClusterName:    ctx,
		KubeconfigPath: kube,
	}); err != nil {
		t.Fatal(err)
	}
}

func profileContextNames(cfg *AppConfig) map[string]struct{} {
	out := map[string]struct{}{}
	for _, p := range cfg.Profiles {
		if p.ClusterName != "" {
			out[p.ClusterName] = struct{}{}
		}
	}
	return out
}

func TestDeleteLiveKubeconfigProfile_doesNotResurrect(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)
	kube := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(kube, []byte(kubeconfigYAML("keep", "drop-me")), 0600); err != nil {
		t.Fatal(err)
	}
	seedLiveKubeProfile(t, "keep-id", "keep", kube)
	seedLiveKubeProfile(t, "drop-id", "drop-me", kube)
	if err := AdoptLiveKubeconfigContext(kube, "keep"); err != nil {
		t.Fatal(err)
	}
	if err := AdoptLiveKubeconfigContext(kube, "drop-me"); err != nil {
		t.Fatal(err)
	}

	if err := DeleteProfileMeta("drop-id"); err != nil {
		t.Fatal(err)
	}
	SyncLiveKubeconfigProfiles()
	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	names := profileContextNames(cfg)
	if _, ok := names["drop-me"]; ok {
		t.Fatalf("deleted context came back: %+v", cfg.Profiles)
	}
	if _, ok := names["keep"]; !ok {
		t.Fatalf("kept context missing: %+v", cfg.Profiles)
	}
}

func TestDeleteLastLiveKubeconfigProfile_stopsWatching(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)
	kube := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(kube, []byte(kubeconfigYAML("only", "other")), 0600); err != nil {
		t.Fatal(err)
	}
	seedLiveKubeProfile(t, "only-id", "only", kube)
	if err := AdoptLiveKubeconfigContext(kube, "only"); err != nil {
		t.Fatal(err)
	}
	if err := DeleteProfileMeta("only-id"); err != nil {
		t.Fatal(err)
	}
	SyncLiveKubeconfigProfiles()
	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Profiles) != 0 {
		t.Fatalf("last delete must fully unlink: %+v", cfg.Profiles)
	}
	if len(cfg.KubeconfigDeferred) != 0 {
		t.Fatalf("deferred must clear after unlink: %v", cfg.KubeconfigDeferred)
	}
}

func TestUnlinkLiveKubeconfig_removesAllAndStopsWatching(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)
	kube := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(kube, []byte(kubeconfigYAML("a", "b")), 0600); err != nil {
		t.Fatal(err)
	}
	seedLiveKubeProfile(t, "a-id", "a", kube)
	seedLiveKubeProfile(t, "b-id", "b", kube)
	if err := AdoptLiveKubeconfigContext(kube, "a"); err != nil {
		t.Fatal(err)
	}

	removed, err := UnlinkLiveKubeconfig(kube)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 2 {
		t.Fatalf("removed: %v", removed)
	}
	SyncLiveKubeconfigProfiles()
	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Profiles) != 0 {
		t.Fatalf("unlink must drop all live profiles: %+v", cfg.Profiles)
	}
	if HasLiveKubeconfigProfiles(cfg) {
		t.Fatal("must stop watching")
	}
}
