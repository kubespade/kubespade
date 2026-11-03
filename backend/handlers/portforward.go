package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func ListPortForwards(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	sessions := services.DefaultPFManager.List(name)
	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

func StartPortForward(c *gin.Context) {
	var body struct {
		Namespace  string `json:"namespace" binding:"required"`
		PodName    string `json:"podName"   binding:"required"`
		LocalPort  int    `json:"localPort"  binding:"required"`
		RemotePort int    `json:"remotePort" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	// Use context.Background() so the port-forward lifetime is not tied to this HTTP request
	pf, err := services.DefaultPFManager.Start(context.Background(), k8sCfg, name,
		body.Namespace, body.PodName, body.LocalPort, body.RemotePort)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusCreated, pf)
}

func StartServicePortForward(c *gin.Context) {
	serviceName := c.Param("serviceName")

	var body struct {
		Namespace  string `json:"namespace"  binding:"required"`
		LocalPort  int    `json:"localPort"  binding:"required"`
		RemotePort int    `json:"remotePort" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	// Use context.Background() so the port-forward lifetime is not tied to this HTTP request
	pf, err := services.DefaultPFManager.StartForService(context.Background(), k8sCfg, name,
		body.Namespace, serviceName, body.LocalPort, body.RemotePort)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusCreated, pf)
}

func StopPortForward(c *gin.Context) {
	id := c.Param("id")
	if !services.DefaultPFManager.Stop(id) {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
