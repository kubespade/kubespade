package services

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type HelmRelease struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Chart        string `json:"chart"`
	ChartVersion string `json:"chartVersion"`
	AppVersion   string `json:"appVersion"`
	Status       string `json:"status"`
	Revision     int    `json:"revision"`
	Updated      int64  `json:"updated"` // Unix seconds
	Description  string `json:"description,omitempty"`
}

type HelmChart struct {
	Name       string   `json:"name"`
	Versions   []string `json:"versions"`
	Releases   int      `json:"releases"`
	Namespaces []string `json:"namespaces"`
}

// HelmRevision is one row in a release's history (all Secret revisions).
type HelmRevision struct {
	Revision     int    `json:"revision"`
	Status       string `json:"status"`
	Chart        string `json:"chart"`
	ChartVersion string `json:"chartVersion"`
	AppVersion   string `json:"appVersion"`
	Updated      int64  `json:"updated"`
	Description  string `json:"description,omitempty"`
	Current      bool   `json:"current"`
}

// internal decoded structure from Helm Secrets
type helmReleaseData struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Version   int    `json:"version"`
	Info      struct {
		LastDeployed string `json:"last_deployed"`
		Status       string `json:"status"`
		Description  string `json:"description"`
	} `json:"info"`
	Chart struct {
		Metadata struct {
			Name       string `json:"name"`
			Version    string `json:"version"`
			AppVersion string `json:"appVersion"`
		} `json:"metadata"`
	} `json:"chart"`
}

// listHelmReleaseData lists Helm release secrets and decodes each release blob.
// namespace empty = all namespaces; name empty = all releases (still filter by owner=helm).
func listHelmReleaseData(ctx context.Context, k8sCfg *rest.Config, namespace, name string) ([]*helmReleaseData, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create k8s client: %w", err)
	}
	sel := "owner=helm"
	if name != "" {
		sel = fmt.Sprintf("owner=helm,name=%s", name)
	}
	secrets, err := client.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: sel,
	})
	if err != nil {
		return nil, fmt.Errorf("list helm secrets: %w", err)
	}
	out := make([]*helmReleaseData, 0, len(secrets.Items))
	for _, secret := range secrets.Items {
		raw, ok := secret.Data["release"]
		if !ok {
			continue
		}
		rls, err := decodeHelmRelease(raw)
		if err != nil {
			continue
		}
		if name != "" && (rls.Name != name || (namespace != "" && rls.Namespace != namespace)) {
			continue
		}
		out = append(out, rls)
	}
	return out, nil
}

func ListHelmReleases(ctx context.Context, k8sCfg *rest.Config) ([]HelmRelease, error) {
	all, err := listHelmReleaseData(ctx, k8sCfg, "", "")
	if err != nil {
		return nil, err
	}

	// Group by release name+namespace, keep only the latest revision
	type key struct{ name, namespace string }
	latest := make(map[key]*helmReleaseData)

	for _, rls := range all {
		k := key{rls.Name, rls.Namespace}
		if existing, ok := latest[k]; !ok || rls.Version > existing.Version {
			latest[k] = rls
		}
	}

	releases := make([]HelmRelease, 0, len(latest))
	for _, rls := range latest {
		releases = append(releases, HelmRelease{
			Name:         rls.Name,
			Namespace:    rls.Namespace,
			Chart:        rls.Chart.Metadata.Name,
			ChartVersion: rls.Chart.Metadata.Version,
			AppVersion:   rls.Chart.Metadata.AppVersion,
			Status:       rls.Info.Status,
			Revision:     rls.Version,
			Updated:      parseHelmTime(rls.Info.LastDeployed),
			Description:  rls.Info.Description,
		})
	}

	sort.Slice(releases, func(i, j int) bool {
		if releases[i].Namespace != releases[j].Namespace {
			return releases[i].Namespace < releases[j].Namespace
		}
		return releases[i].Name < releases[j].Name
	})

	return releases, nil
}

// ListHelmReleaseHistory returns all revisions for one release (newest first).
func ListHelmReleaseHistory(ctx context.Context, k8sCfg *rest.Config, namespace, name string) ([]HelmRevision, error) {
	if err := requireNsName(namespace, name); err != nil {
		return nil, err
	}
	all, err := listHelmReleaseData(ctx, k8sCfg, namespace, name)
	if err != nil {
		return nil, err
	}

	var rows []HelmRevision
	maxRev := 0
	for _, rls := range all {
		if rls.Version > maxRev {
			maxRev = rls.Version
		}
		rows = append(rows, HelmRevision{
			Revision:     rls.Version,
			Status:       rls.Info.Status,
			Chart:        rls.Chart.Metadata.Name,
			ChartVersion: rls.Chart.Metadata.Version,
			AppVersion:   rls.Chart.Metadata.AppVersion,
			Updated:      parseHelmTime(rls.Info.LastDeployed),
			Description:  rls.Info.Description,
		})
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("release %s/%s not found", namespace, name)
	}

	sort.Slice(rows, func(i, j int) bool {
		return rows[i].Revision > rows[j].Revision
	})
	for i := range rows {
		rows[i].Current = rows[i].Revision == maxRev
	}
	return rows, nil
}

func ListHelmCharts(ctx context.Context, k8sCfg *rest.Config) ([]HelmChart, error) {
	releases, err := ListHelmReleases(ctx, k8sCfg)
	if err != nil {
		return nil, err
	}

	type chartData struct {
		versions   map[string]struct{}
		namespaces map[string]struct{}
		releases   int
	}
	byChart := make(map[string]*chartData)

	for _, rls := range releases {
		cd, ok := byChart[rls.Chart]
		if !ok {
			cd = &chartData{
				versions:   make(map[string]struct{}),
				namespaces: make(map[string]struct{}),
			}
			byChart[rls.Chart] = cd
		}
		cd.versions[rls.ChartVersion] = struct{}{}
		cd.namespaces[rls.Namespace] = struct{}{}
		cd.releases++
	}

	result := make([]HelmChart, 0, len(byChart))
	for name, cd := range byChart {
		versions := make([]string, 0, len(cd.versions))
		for v := range cd.versions {
			versions = append(versions, v)
		}
		sort.Strings(versions)

		namespaces := make([]string, 0, len(cd.namespaces))
		for ns := range cd.namespaces {
			namespaces = append(namespaces, ns)
		}
		sort.Strings(namespaces)

		result = append(result, HelmChart{
			Name:       name,
			Versions:   versions,
			Releases:   cd.releases,
			Namespaces: namespaces,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})

	return result, nil
}

// decodeHelmRelease decodes a Helm v3 Secret payload: base64 → gzip → JSON.
func decodeHelmRelease(raw []byte) (*helmReleaseData, error) {
	decoded, err := base64.StdEncoding.DecodeString(string(raw))
	if err != nil {
		return nil, fmt.Errorf("base64: %w", err)
	}
	gr, err := gzip.NewReader(bytes.NewReader(decoded))
	if err != nil {
		return nil, fmt.Errorf("gzip: %w", err)
	}
	defer gr.Close()
	jsonData, err := io.ReadAll(gr)
	if err != nil {
		return nil, fmt.Errorf("gzip read: %w", err)
	}
	var rls helmReleaseData
	if err := json.Unmarshal(jsonData, &rls); err != nil {
		return nil, fmt.Errorf("json: %w", err)
	}
	return &rls, nil
}

func parseHelmTime(s string) int64 {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Unix()
		}
	}
	return 0
}
