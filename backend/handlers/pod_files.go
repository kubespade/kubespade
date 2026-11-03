package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

type podFileBody struct {
	Namespace  string `json:"namespace"`
	Container  string `json:"container"`
	RemotePath string `json:"remotePath"`
	LocalPath  string `json:"localPath"`
	NameFilter string `json:"nameFilter"`
}

// StatPodFile returns whether remotePath is a file, directory, or missing.
func StatPodFile(c *gin.Context) {
	podName := c.Param("podName")
	var body podFileBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Container == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "container is required"})
		return
	}
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	kind, err := services.StatPodPath(c.Request.Context(), k8sCfg, body.Namespace, podName, body.Container, body.RemotePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": kind})
}

// PullPodFile copies a file/directory from the pod to a local absolute path.
func PullPodFile(c *gin.Context) {
	podName := c.Param("podName")
	var body podFileBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Container == "" || body.LocalPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "container and localPath are required"})
		return
	}
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.CopyFromPod(c.Request.Context(), k8sCfg, body.Namespace, podName, body.Container, body.RemotePath, body.LocalPath); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// PushPodFile copies a local file/directory into remotePath (destination directory in the pod).
func PushPodFile(c *gin.Context) {
	podName := c.Param("podName")
	var body podFileBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Container == "" || body.LocalPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "container and localPath are required"})
		return
	}
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	if err := services.CopyToPod(c.Request.Context(), k8sCfg, body.Namespace, podName, body.Container, body.RemotePath, body.LocalPath); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListPodFiles lists entries in a remote directory.
func ListPodFiles(c *gin.Context) {
	podName := c.Param("podName")
	var body podFileBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Container == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "container is required"})
		return
	}
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	entries, err := services.ListPodDirectory(c.Request.Context(), k8sCfg, body.Namespace, podName, body.Container, body.RemotePath, body.NameFilter)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries.Entries, "truncated": entries.Truncated})
}
