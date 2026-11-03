package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func GetCRDGroups(c *gin.Context) {
	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	groups, err := services.ListCRDGroups(c.Request.Context(), k8sCfg)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

func StreamCRDInstances(c *gin.Context) {
	group := c.Param("group")
	version := c.Param("version")
	plural := c.Param("plural")
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

		err = services.WatchCRDInstances(ctx, k8sCfg, group, version, plural, namespace, sendJSON)
		select {
		case <-ctx.Done():
			return
		default:
			if err == nil {
				return
			}
			if isAuthError(err) {
				log.Printf("[SSE-crd] %s/%s/%s auth error: %v", group, version, plural, err)
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
			log.Printf("[SSE-crd] %s/%s/%s watch error: %v — reconnecting in 3s", group, version, plural, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}
}
