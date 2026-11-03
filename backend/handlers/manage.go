package handlers

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func GetResourceYAML(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	yaml, err := services.GetResourceYAML(c.Request.Context(), k8sCfg, kind, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(yaml))
}

func CreateResource(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	createdName, err := services.CreateResourceYAML(c.Request.Context(), k8sCfg, kind, namespace, string(body))
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "name": createdName})
}

func ApplyResourceYAML(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	if err := services.ApplyResourceYAML(c.Request.Context(), k8sCfg, kind, namespace, resourceName, string(body)); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func ApplyManifest(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	results, err := services.ApplyManifestYAML(c.Request.Context(), k8sCfg, string(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "applied": results})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "applied": results})
}

func DeleteResource(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	opts, err := services.ParseDeleteResourceOptions(c.Query("force"), c.Query("gracePeriod"), c.Query("propagation"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.DeleteResource(c.Request.Context(), k8sCfg, kind, namespace, resourceName, opts); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func GetCRDResourceYAML(c *gin.Context) {
	group := c.Param("group")
	version := c.Param("version")
	plural := c.Param("plural")
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	yaml, err := services.GetCRDResourceYAML(c.Request.Context(), k8sCfg, group, version, plural, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(yaml))
}

func ApplyCRDResourceYAML(c *gin.Context) {
	group := c.Param("group")
	version := c.Param("version")
	plural := c.Param("plural")
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	if err := services.ApplyCRDResourceYAML(c.Request.Context(), k8sCfg, group, version, plural, namespace, resourceName, string(body)); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func DeleteCRDResource(c *gin.Context) {
	group := c.Param("group")
	version := c.Param("version")
	plural := c.Param("plural")
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	opts, err := services.ParseDeleteResourceOptions(c.Query("force"), c.Query("gracePeriod"), c.Query("propagation"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.DeleteCRDResource(c.Request.Context(), k8sCfg, group, version, plural, namespace, resourceName, opts); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
