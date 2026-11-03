package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func GetClusterMetricsCollector(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	st, err := services.GetCollectorStatus(c.Request.Context(), k8sCfg)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func PutClusterMetricsCollector(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	var body struct {
		Enabled       *bool `json:"enabled"`
		RetentionDays *int  `json:"retentionDays"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Enabled != nil && !*body.Enabled {
		st, err := services.DisableCollector(c.Request.Context(), k8sCfg)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, st)
		return
	}

	days := services.CMCDefaultRetention
	if body.RetentionDays != nil {
		days = *body.RetentionDays
	}
	st, err := services.EnableCollector(c.Request.Context(), k8sCfg, days)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

func GetClusterMetricsCollectorHistory(c *gin.Context) {
	kind := c.Param("kind")
	name := strings.ToLower(c.Param("name"))
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	prefs := services.MigrateLegacyMetricsSourcePublic(name)

	switch kind {
	case "cluster":
		res := services.ResolveMetricsHistory(c.Request.Context(), name, k8sCfg, prefs, "cluster", "", "", nil)
		c.JSON(http.StatusOK, gin.H{"points": res.Points, "source": res.Source})
	case "nodes":
		n := c.Query("name")
		if n == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
			return
		}
		res := services.ResolveMetricsHistory(c.Request.Context(), name, k8sCfg, prefs, "node", n, "", nil)
		c.JSON(http.StatusOK, gin.H{"points": res.Points, "source": res.Source})
	case "pods":
		n := c.Query("name")
		ns := c.Query("namespace")
		if n == "" || ns == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name and namespace are required"})
			return
		}
		res := services.ResolveMetricsHistory(c.Request.Context(), name, k8sCfg, prefs, "pod", n, ns, nil)
		c.JSON(http.StatusOK, gin.H{"points": res.Points, "source": res.Source})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind must be cluster|nodes|pods"})
	}
}
