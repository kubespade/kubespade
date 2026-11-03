package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func GetApplications(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	list, err := services.ListApplications(c.Request.Context(), k8sCfg)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, list)
}

func GetNetworkMap(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	m, err := services.ListNetworkMap(c.Request.Context(), k8sCfg, c.Query("namespace"))
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, m)
}

func GetResources(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	namespace := c.Query("namespace")
	list, err := services.ListResources(c.Request.Context(), k8sCfg, kind, namespace)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, list)
}

func GetResourceDetail(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	detail, err := services.GetResourceDetail(c.Request.Context(), k8sCfg, kind, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

func GetResourceEvents(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	events, err := services.ListResourceEvents(c.Request.Context(), k8sCfg, kind, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, events)
}

func GetCRDResourceDetail(c *gin.Context) {
	group := c.Param("group")
	version := c.Param("version")
	plural := c.Param("plural")
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	detail, err := services.GetCRDResourceDetail(c.Request.Context(), k8sCfg, group, version, plural, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

func GetCRDResourceEvents(c *gin.Context) {
	resourceName := c.Param("resourceName")
	namespace := c.Query("namespace")
	crdKind := c.Query("kind")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}
	events, err := services.ListCRDResourceEvents(c.Request.Context(), k8sCfg, crdKind, namespace, resourceName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, events)
}

// StreamResources opens an SSE stream that pushes real-time resource state
// using the Kubernetes Watch API. Reconnects automatically on watch channel close.
func StreamResources(c *gin.Context) {
	kind := strings.ToLower(c.Param("kind"))
	namespace := c.Query("namespace")

	name, sess, ok := resolveSession(c)
	if !ok {
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	ctx := c.Request.Context()
	flusher, _ := c.Writer.(http.Flusher)

	sendJSON := func(v any) bool {
		data, err := json.Marshal(v)
		if err != nil {
			return false
		}
		_, err = fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		if err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	authRetries := 0
	for {
		k8sCfg, err := sess.GetK8sConfig(ctx, "")
		if err != nil {
			if services.IsNeedsMFA(err) {
				sendJSON(map[string]any{"type": "needsMFA"})
			} else {
				sendJSON(map[string]any{"type": "error", "message": err.Error()})
			}
			return
		}

		err = services.WatchResources(ctx, k8sCfg, kind, namespace, sendJSON)
		select {
		case <-ctx.Done():
			return
		default:
			if err == nil {
				return
			}
			if isAuthError(err) {
				log.Printf("[SSE-res] %s/%s auth error: %v", kind, namespace, err)
				if authRetries >= 1 {
					if sess.Meta.Type == "aws" || sess.Meta.Type == "" {
						services.ClearAWSSession(name)
					}
					if sess.Meta.MFASerial != "" {
						sendJSON(map[string]any{"type": "needsMFA"})
					} else {
						sendJSON(map[string]any{"type": "error", "message": err.Error()})
					}
					return
				}
				authRetries++
				sess.InvalidateTokens()
				select {
				case <-ctx.Done():
					return
				case <-time.After(500 * time.Millisecond):
				}
				continue
			}
			log.Printf("[SSE-res] %s/%s watch error: %v — reconnecting in 3s", kind, namespace, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}
}
