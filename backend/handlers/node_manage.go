package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func CordonNodeHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.CordonNode(c.Request.Context(), k8sCfg, nodeName); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func UncordonNodeHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.UncordonNode(c.Request.Context(), k8sCfg, nodeName); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func DrainNodeHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")

	send := func(line string) {
		fmt.Fprintf(c.Writer, "data: %s\n\n", line)
		c.Writer.Flush()
	}

	err := services.DrainNode(c.Request.Context(), k8sCfg, nodeName, send)
	if err != nil {
		send("ERROR: " + err.Error())
	}
	send("__done__")
}

func ListNodePodsHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	pods, err := services.ListNodePods(c.Request.Context(), k8sCfg, nodeName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pods": pods})
}

func ListNodeTaintsHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	taints, err := services.ListNodeTaints(c.Request.Context(), k8sCfg, nodeName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"taints": taints})
}

func AddNodeTaintHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")

	var body struct {
		Key    string `json:"key"`
		Value  string `json:"value"`
		Effect string `json:"effect"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.AddNodeTaint(c.Request.Context(), k8sCfg, nodeName, body.Key, body.Value, body.Effect); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func RemoveNodeTaintHandler(c *gin.Context) {
	nodeName := c.Param("nodeName")
	key := c.Query("key")
	effect := c.Query("effect")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.RemoveNodeTaint(c.Request.Context(), k8sCfg, nodeName, key, effect); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
