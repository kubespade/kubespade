package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func GetHelmReleases(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	releases, err := services.ListHelmReleases(c.Request.Context(), k8sCfg)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"releases": releases})
}

func GetHelmCharts(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	charts, err := services.ListHelmCharts(c.Request.Context(), k8sCfg)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"charts": charts})
}

func GetHelmReleaseHistory(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("releaseName")
	revs, err := services.ListHelmReleaseHistory(c.Request.Context(), k8sCfg, ns, name)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"revisions": revs})
}

func UninstallHelmRelease(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("releaseName")
	keepHistory := c.Query("keepHistory") == "1" || c.Query("keepHistory") == "true"
	if err := services.UninstallHelmRelease(c.Request.Context(), k8sCfg, ns, name, keepHistory); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type helmRollbackBody struct {
	Revision int `json:"revision"`
}

func RollbackHelmRelease(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("releaseName")

	var body helmRollbackBody
	if err := c.ShouldBindJSON(&body); err != nil {
		// Allow revision as query for simple clients.
		if q := c.Query("revision"); q != "" {
			if n, err2 := strconv.Atoi(q); err2 == nil {
				body.Revision = n
			}
		}
	}
	if body.Revision < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "revision is required"})
		return
	}
	if err := services.RollbackHelmRelease(c.Request.Context(), k8sCfg, ns, name, body.Revision); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type helmWriteBody struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Chart       string `json:"chart"`
	Repo        string `json:"repo"`
	Version     string `json:"version"`
	ValuesYAML  string `json:"valuesYaml"`
	ReuseValues bool   `json:"reuseValues"`
}

func GetHelmReleaseValues(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("releaseName")
	all := c.Query("all") == "1" || c.Query("all") == "true"
	yamlText, err := services.GetHelmReleaseValuesYAML(c.Request.Context(), k8sCfg, ns, name, all)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"valuesYaml": yamlText})
}

func InstallHelmRelease(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	var body helmWriteBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}
	ns := strings.TrimSpace(body.Namespace)
	name := strings.TrimSpace(body.Name)
	if ns == "" || name == "" || strings.TrimSpace(body.Chart) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name, namespace, and chart are required"})
		return
	}
	opts := services.HelmChartWriteOpts{
		Chart:      body.Chart,
		RepoURL:    body.Repo,
		Version:    body.Version,
		ValuesYAML: body.ValuesYAML,
	}
	if err := services.InstallHelmRelease(c.Request.Context(), k8sCfg, ns, name, opts); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func UpgradeHelmRelease(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("releaseName")
	var body helmWriteBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}
	opts := services.HelmChartWriteOpts{
		Chart:      body.Chart,
		RepoURL:    body.Repo,
		Version:    body.Version,
		ValuesYAML: body.ValuesYAML,
	}
	if err := services.UpgradeHelmRelease(c.Request.Context(), k8sCfg, ns, name, opts, body.ReuseValues); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func GetHelmRepos(c *gin.Context) {
	if _, _, _, ok := resolveK8s(c); !ok {
		return
	}
	repos, err := services.ListHelmRepos()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"repos": repos})
}

func GetHelmRepoCharts(c *gin.Context) {
	if _, _, _, ok := resolveK8s(c); !ok {
		return
	}
	repoName := strings.TrimSpace(c.Query("repo"))
	repoURL := strings.TrimSpace(c.Query("url"))
	chartName := strings.TrimSpace(c.Query("chart"))
	if repoName == "" && repoURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url or repo query param is required"})
		return
	}
	if chartName != "" {
		versions, err := services.ListHelmRepoChartVersions(repoName, repoURL, chartName)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"versions": versions})
		return
	}
	charts, err := services.ListHelmRepoCharts(repoName, repoURL)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"charts": charts})
}

func GetHelmChartValues(c *gin.Context) {
	if _, _, _, ok := resolveK8s(c); !ok {
		return
	}
	chartName := strings.TrimSpace(c.Query("chart"))
	repoURL := strings.TrimSpace(c.Query("url"))
	repoName := strings.TrimSpace(c.Query("repo"))
	version := strings.TrimSpace(c.Query("version"))
	if chartName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chart query param is required"})
		return
	}
	if repoURL == "" && repoName != "" {
		repos, err := services.ListHelmRepos()
		if err == nil {
			for _, r := range repos {
				if r.Name == repoName {
					repoURL = r.URL
					break
				}
			}
		}
	}
	yamlText, err := services.GetHelmChartDefaultValuesYAML(chartName, repoURL, version)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"valuesYaml": yamlText, "version": version})
}
