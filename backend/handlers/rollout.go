package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func PauseDeployment(c *gin.Context) {
	setDeploymentPaused(c, true)
}

func ResumeDeployment(c *gin.Context) {
	setDeploymentPaused(c, false)
}

func setDeploymentPaused(c *gin.Context, paused bool) {
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.SetDeploymentPaused(c.Request.Context(), k8sCfg, namespace, resourceName, paused); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func ListDeploymentRevisions(c *gin.Context) {
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	revs, err := services.ListDeploymentRevisions(c.Request.Context(), k8sCfg, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"revisions": revs})
}

func UndoDeployment(c *gin.Context) {
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	var body struct {
		ToRevision int64 `json:"toRevision"`
	}
	_ = c.ShouldBindJSON(&body)

	// Also accept ?toRevision=N
	if body.ToRevision == 0 {
		if q := c.Query("toRevision"); q != "" {
			if v, err := strconv.ParseInt(q, 10, 64); err == nil {
				body.ToRevision = v
			}
		}
	}

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.UndoDeploymentRollout(c.Request.Context(), k8sCfg, namespace, resourceName, body.ToRevision); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
