package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/debug"
)

func GetDebugState(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"enabled": debug.IsEnabled()})
}

func SetDebugState(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	debug.SetEnabled(req.Enabled)
	c.JSON(http.StatusOK, gin.H{"enabled": debug.IsEnabled()})
}

func GetDebugLogs(c *gin.Context) {
	logs := debug.GetLogs()
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.String(http.StatusOK, logs)
}
