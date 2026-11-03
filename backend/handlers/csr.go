package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func ApproveCSR(c *gin.Context) {
	setCSRApproval(c, true)
}

func DenyCSR(c *gin.Context) {
	setCSRApproval(c, false)
}

func setCSRApproval(c *gin.Context, approve bool) {
	resourceName := c.Param("resourceName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.ApproveOrDenyCSR(c.Request.Context(), k8sCfg, resourceName, approve); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
