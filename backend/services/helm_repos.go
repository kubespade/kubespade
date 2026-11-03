package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/helmpath"
	"helm.sh/helm/v3/pkg/repo"
)

// HelmRepoEntry is a local Helm repository from repositories.yaml.
type HelmRepoEntry struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// HelmRepoChartSummary is one chart name from a repo index (latest version only).
type HelmRepoChartSummary struct {
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	LatestVersion string `json:"latestVersion,omitempty"`
}

// loadRepoFileOrEmpty loads repositories.yaml, treating a missing file as empty.
func loadRepoFileOrEmpty(path string) (*repo.File, error) {
	f, err := repo.LoadFile(path)
	if err != nil {
		if os.IsNotExist(err) || strings.Contains(err.Error(), "couldn't load repositories file") {
			return repo.NewFile(), nil
		}
		return nil, err
	}
	return f, nil
}

// ListHelmRepos returns repositories from the local Helm repositories.yaml.
func ListHelmRepos() ([]HelmRepoEntry, error) {
	settings := helmSettings()
	f, err := loadRepoFileOrEmpty(settings.RepositoryConfig)
	if err != nil {
		return nil, err
	}
	out := make([]HelmRepoEntry, 0, len(f.Repositories))
	for _, e := range f.Repositories {
		if e == nil || strings.TrimSpace(e.Name) == "" || strings.TrimSpace(e.URL) == "" {
			continue
		}
		out = append(out, HelmRepoEntry{Name: e.Name, URL: e.URL})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func normalizeRepoURL(u string) string {
	return strings.TrimRight(strings.TrimSpace(u), "/")
}

func findLocalRepoEntry(name, url string) (*repo.Entry, error) {
	settings := helmSettings()
	f, err := loadRepoFileOrEmpty(settings.RepositoryConfig)
	if err != nil {
		return nil, err
	}
	if len(f.Repositories) == 0 {
		return nil, nil
	}
	wantURL := normalizeRepoURL(url)
	wantName := strings.TrimSpace(name)
	for _, e := range f.Repositories {
		if e == nil {
			continue
		}
		if wantName != "" && e.Name == wantName {
			return e, nil
		}
		if wantURL != "" && normalizeRepoURL(e.URL) == wantURL {
			return e, nil
		}
	}
	return nil, nil
}

func ephemeralRepoCacheName(url string) string {
	sum := sha256.Sum256([]byte(normalizeRepoURL(url)))
	return "ks-url-" + hex.EncodeToString(sum[:8])
}

func resolveRepoEntry(name, url string) (*repo.Entry, error) {
	if e, err := findLocalRepoEntry(name, url); err != nil {
		return nil, err
	} else if e != nil {
		return e, nil
	}
	u := strings.TrimSpace(url)
	if u == "" {
		return nil, fmt.Errorf("repo URL or name is required")
	}
	return &repo.Entry{
		Name: ephemeralRepoCacheName(u),
		URL:  u,
	}, nil
}

func loadOrFetchIndex(entry *repo.Entry) (*repo.IndexFile, error) {
	settings := helmSettings()
	_ = os.MkdirAll(settings.RepositoryCache, 0o755)

	cachePath := filepath.Join(settings.RepositoryCache, helmpath.CacheIndexFile(entry.Name))
	if st, err := os.Stat(cachePath); err == nil && st.Size() > 0 {
		idx, err := repo.LoadIndexFile(cachePath)
		if err == nil {
			return idx, nil
		}
	}

	cr, err := repo.NewChartRepository(entry, getter.All(settings))
	if err != nil {
		return nil, fmt.Errorf("open chart repository: %w", err)
	}
	cr.CachePath = settings.RepositoryCache
	path, err := cr.DownloadIndexFile()
	if err != nil {
		return nil, fmt.Errorf("download repo index: %w", err)
	}
	idx, err := repo.LoadIndexFile(path)
	if err != nil {
		return nil, fmt.Errorf("load repo index: %w", err)
	}
	return idx, nil
}

// ListHelmRepoCharts returns chart name summaries for a local or one-shot repo URL.
func ListHelmRepoCharts(repoName, repoURL string) ([]HelmRepoChartSummary, error) {
	entry, err := resolveRepoEntry(repoName, repoURL)
	if err != nil {
		return nil, err
	}
	idx, err := loadOrFetchIndex(entry)
	if err != nil {
		return nil, err
	}

	out := make([]HelmRepoChartSummary, 0, len(idx.Entries))
	for name, versions := range idx.Entries {
		if len(versions) == 0 || versions[0] == nil || versions[0].Metadata == nil {
			continue
		}
		meta := versions[0].Metadata
		out = append(out, HelmRepoChartSummary{
			Name:          name,
			Description:   meta.Description,
			LatestVersion: meta.Version,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

const maxHelmRepoVersions = 300

type helmVer struct {
	raw string
	sv  *semver.Version
}

func (v helmVer) majorKey() string {
	if v.sv != nil {
		return fmt.Sprintf("%d", v.sv.Major())
	}
	parts := strings.SplitN(v.raw, ".", 2)
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return v.raw
}

// ListHelmRepoChartVersions returns semver-descending versions for one chart.
// Returns all versions when under the cap. If capped, keeps a newest head and
// at least a few releases from each major so older majors stay reachable.
func ListHelmRepoChartVersions(repoName, repoURL, chartName string) ([]string, error) {
	chartName = strings.TrimSpace(chartName)
	if chartName == "" {
		return nil, fmt.Errorf("chart name is required")
	}
	entry, err := resolveRepoEntry(repoName, repoURL)
	if err != nil {
		return nil, err
	}
	idx, err := loadOrFetchIndex(entry)
	if err != nil {
		return nil, err
	}
	versions, ok := idx.Entries[chartName]
	if !ok || len(versions) == 0 {
		for name, vs := range idx.Entries {
			if strings.EqualFold(name, chartName) {
				versions = vs
				ok = true
				break
			}
		}
	}
	if !ok || len(versions) == 0 {
		return []string{}, nil
	}

	parsed := make([]helmVer, 0, len(versions))
	for _, cv := range versions {
		if cv == nil || cv.Metadata == nil || cv.Metadata.Version == "" {
			continue
		}
		raw := cv.Metadata.Version
		sv, err := semver.NewVersion(raw)
		if err != nil {
			parsed = append(parsed, helmVer{raw: raw})
			continue
		}
		parsed = append(parsed, helmVer{raw: raw, sv: sv})
	}
	sort.SliceStable(parsed, func(i, j int) bool {
		a, b := parsed[i], parsed[j]
		if a.sv != nil && b.sv != nil {
			return a.sv.GreaterThan(b.sv)
		}
		if a.sv != nil {
			return true
		}
		if b.sv != nil {
			return false
		}
		return a.raw > b.raw
	})

	deduped := make([]helmVer, 0, len(parsed))
	seenRaw := map[string]struct{}{}
	for _, v := range parsed {
		if _, ok := seenRaw[v.raw]; ok {
			continue
		}
		seenRaw[v.raw] = struct{}{}
		deduped = append(deduped, v)
	}

	if len(deduped) <= maxHelmRepoVersions {
		out := make([]string, len(deduped))
		for i, v := range deduped {
			out[i] = v.raw
		}
		return out, nil
	}
	return pickVersionsAcrossMajors(deduped, maxHelmRepoVersions), nil
}

// pickVersionsAcrossMajors keeps newest versions first, while ensuring every
// major line contributes a few entries (so a long 6.x streak does not hide 5.x).
func pickVersionsAcrossMajors(parsed []helmVer, limit int) []string {
	const perMajorFloor = 3
	const headPrefer = 120

	seen := map[string]struct{}{}
	out := make([]string, 0, limit)
	majorCount := map[string]int{}
	add := func(v helmVer) bool {
		if _, ok := seen[v.raw]; ok {
			return false
		}
		if len(out) >= limit {
			return false
		}
		seen[v.raw] = struct{}{}
		out = append(out, v.raw)
		majorCount[v.majorKey()]++
		return true
	}

	head := headPrefer
	if head > limit {
		head = limit
	}
	for i := 0; i < len(parsed) && len(out) < head; i++ {
		add(parsed[i])
	}

	for _, v := range parsed {
		if majorCount[v.majorKey()] >= perMajorFloor {
			continue
		}
		add(v)
		if len(out) >= limit {
			break
		}
	}

	for _, v := range parsed {
		if len(out) >= limit {
			break
		}
		add(v)
	}

	rank := make(map[string]int, len(parsed))
	for i, v := range parsed {
		rank[v.raw] = i
	}
	sort.SliceStable(out, func(i, j int) bool {
		return rank[out[i]] < rank[out[j]]
	})
	return out
}
