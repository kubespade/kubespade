package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func EvictPod(c *gin.Context) {
	podName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.EvictPod(c.Request.Context(), k8sCfg, namespace, podName); err != nil {
		msg := err.Error()
		// 429 = PodDisruptionBudget would be violated
		if strings.Contains(msg, "429") || strings.Contains(msg, "Cannot evict") {
			c.JSON(http.StatusConflict, gin.H{"error": "Eviction blocked by PodDisruptionBudget: " + msg})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func RestartWorkload(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.RestartWorkload(c.Request.Context(), k8sCfg, kind, namespace, resourceName); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func ScaleWorkload(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	var body struct {
		Replicas int32 `json:"replicas"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.ScaleWorkload(c.Request.Context(), k8sCfg, kind, namespace, resourceName, body.Replicas); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func SuspendCronJob(c *gin.Context) {
	setCronJobSuspend(c, true)
}

func ResumeCronJob(c *gin.Context) {
	setCronJobSuspend(c, false)
}

func setCronJobSuspend(c *gin.Context, suspend bool) {
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.SetCronJobSuspend(c.Request.Context(), k8sCfg, namespace, resourceName, suspend); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func TriggerCronJob(c *gin.Context) {
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	jobName, err := services.TriggerCronJob(c.Request.Context(), k8sCfg, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "jobName": jobName})
}
