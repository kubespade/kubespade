package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
	rest "k8s.io/client-go/rest"
)

func ListPodMetrics(c *gin.Context) {
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	items, err := services.ListAllPodMetrics(c.Request.Context(), k8sCfg, namespace)
	if err != nil {
		if services.IsMetricsUnavailable(err) {
			c.JSON(http.StatusOK, gin.H{"items": map[string]interface{}{}})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func GetPodMetrics(c *gin.Context) {
	podName := c.Param("podName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	metrics, err := services.GetPodMetrics(c.Request.Context(), k8sCfg, namespace, podName)
	if err != nil {
		// metrics-server not installed or pod not yet scraped — return empty gracefully
		if services.IsMetricsUnavailable(err) {
			c.JSON(http.StatusOK, &services.PodMetrics{Containers: []services.ContainerMetrics{}})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, metrics)
}

func ListNodeMetrics(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	items, err := services.ListAllNodeMetrics(c.Request.Context(), k8sCfg)
	if err != nil {
		if services.IsMetricsUnavailable(err) {
			c.JSON(http.StatusOK, gin.H{"items": map[string]interface{}{}})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func GetPodMetricsHistory(c *gin.Context) {
	podName := c.Param("podName")
	namespace := c.Query("namespace")

	name, sess, ok := resolveSession(c)
	if !ok {
		return
	}

	getCfg := func(ctx context.Context) (*rest.Config, error) {
		return sess.GetK8sConfig(ctx, "")
	}
	services.GlobalMetricsCollector.EnsureStarted(name, getCfg)

	local := services.GlobalMetricsCollector.GetHistory(name, namespace, podName)
	prefs := services.MigrateLegacyMetricsSourcePublic(name)
	var k8sCfg *rest.Config
	if cfg, err := sess.GetK8sConfig(c.Request.Context(), ""); err == nil {
		k8sCfg = cfg
	}
	res := services.ResolveMetricsHistory(c.Request.Context(), name, k8sCfg, prefs, "pod", podName, namespace, local)
	c.JSON(http.StatusOK, gin.H{"points": res.Points, "source": res.Source})
}

func GetNodeMetricsHistory(c *gin.Context) {
	nodeName := c.Param("nodeName")

	name, sess, ok := resolveSession(c)
	if !ok {
		return
	}

	getCfg := func(ctx context.Context) (*rest.Config, error) {
		return sess.GetK8sConfig(ctx, "")
	}
	services.GlobalMetricsCollector.EnsureStarted(name, getCfg)

	local := services.GlobalMetricsCollector.GetNodeHistory(name, nodeName)
	prefs := services.MigrateLegacyMetricsSourcePublic(name)
	var k8sCfg *rest.Config
	if cfg, err := sess.GetK8sConfig(c.Request.Context(), ""); err == nil {
		k8sCfg = cfg
	}
	res := services.ResolveMetricsHistory(c.Request.Context(), name, k8sCfg, prefs, "node", nodeName, "", local)
	c.JSON(http.StatusOK, gin.H{"points": res.Points, "source": res.Source})
}

func GetNodeMetricsHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	m, err := services.GetNodeMetrics(c.Request.Context(), k8sCfg, nodeName)
	if err != nil {
		if services.IsMetricsUnavailable(err) {
			c.JSON(http.StatusOK, &services.NodeMetricsSummary{})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, m)
}
