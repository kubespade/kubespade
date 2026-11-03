package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func GetMetricsSource(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	prefs := services.MigrateLegacyMetricsSourcePublic(name)
	discovered := []services.PrometheusRef{}
	var selected *services.PrometheusRef
	var externalURL string

	if sess, ok := resolveSessionQuiet(c, name); ok {
		if k8sCfg, err := sess.GetK8sConfig(c.Request.Context(), ""); err == nil {
			if list, err := services.DiscoverPrometheus(c.Request.Context(), k8sCfg, true); err == nil {
				discovered = list
				if len(list) > 0 && prefs.PrometheusURL == "" && prefs.PrometheusNamespace == "" && prefs.PrometheusService == "" {
					services.MaybePersistDiscoveredPrometheus(name, list[0])
					prefs = services.LoadProfileMetricsPrefs(name)
				}
			}
			ref, ext, _, okRef := services.ResolvePrometheusEndpoint(c.Request.Context(), k8sCfg, prefs)
			if okRef {
				if ext != "" {
					externalURL = ext
				} else if ref.Name != "" {
					cp := ref
					selected = &cp
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"source":              prefs.Source,
		"prometheusNamespace": prefs.PrometheusNamespace,
		"prometheusService":   prefs.PrometheusService,
		"prometheusPort":      prefs.PrometheusPort,
		"prometheusURL":       prefs.PrometheusURL,
		"hasBearer":           prefs.PrometheusBearer != "",
		"discovered":          discovered,
		"selected":            selected,
		"resolvedExternalURL": externalURL,
	})
}

func PutMetricsSource(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	var body struct {
		Source              string `json:"source"`
		PrometheusNamespace string `json:"prometheusNamespace"`
		PrometheusService   string `json:"prometheusService"`
		PrometheusPort      string `json:"prometheusPort"`
		PrometheusURL       string `json:"prometheusURL"`
		PrometheusBearer    string `json:"prometheusBearer"`
		ClearBearer         bool   `json:"clearBearer"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	prefs := services.LoadProfileMetricsPrefs(name)
	prefs.Source = body.Source
	prefs.PrometheusNamespace = body.PrometheusNamespace
	prefs.PrometheusService = body.PrometheusService
	prefs.PrometheusPort = body.PrometheusPort
	prefs.PrometheusURL = body.PrometheusURL
	if body.ClearBearer {
		prefs.PrometheusBearer = ""
	} else if strings.TrimSpace(body.PrometheusBearer) != "" {
		prefs.PrometheusBearer = strings.TrimSpace(body.PrometheusBearer)
	}
	if err := services.SaveProfileMetricsPrefs(name, prefs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Re-read without aborting on disconnect.
	c.Params = append(c.Params, gin.Param{Key: "name", Value: name})
	GetMetricsSource(c)
}

func DiscoverPrometheusHandler(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	list, err := services.DiscoverPrometheus(c.Request.Context(), k8sCfg, true)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}
