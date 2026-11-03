package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func CheckAccessHandler(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	var req struct {
		Checks []services.AccessCheck `json:"checks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	results, err := services.CheckAccess(c.Request.Context(), k8sCfg, req.Checks)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}
