package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
	rest "k8s.io/client-go/rest"
)

func isAuthError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unauthorized") ||
		strings.Contains(msg, "forbidden") ||
		strings.Contains(msg, " 401") ||
		strings.Contains(msg, " 403")
}

// GetClusterInfo returns a one-shot K8s cluster snapshot.
func GetClusterInfo(c *gin.Context) {
	mfaToken := c.Query("mfaToken")

	_, sess, ok := resolveSession(c)
	if !ok {
		return
	}

	k8sCfg, err := sess.GetK8sConfig(c.Request.Context(), mfaToken)
	if err != nil {
		if services.IsNeedsMFA(err) {
			c.JSON(http.StatusUnauthorized, gin.H{"needsMFA": true})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	info, err := services.GetClusterInfo(c.Request.Context(), k8sCfg, sess.DisplayLabel())
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, info)
}

// StreamClusterInfo opens an SSE stream that pushes real-time cluster state
// using the Kubernetes Watch API. The client receives a JSON event on every
// node or namespace change. When the aws-vault session expires the stream
// sends {"type":"needsMFA"} and closes; the client should reconnect with
// ?mfaToken=<code>.
func StreamClusterInfo(c *gin.Context) {
	mfaToken := c.Query("mfaToken")

	name, sess, ok := resolveSession(c)
	if !ok {
		return
	}

	// Start background metrics collection as soon as the cluster is open.
	services.GlobalMetricsCollector.EnsureStarted(name, func(ctx context.Context) (*rest.Config, error) {
		return sess.GetK8sConfig(ctx, "")
	})

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
		k8sCfg, err := sess.GetK8sConfig(ctx, mfaToken)
		mfaToken = "" // only consume the token on the first attempt
		if err != nil {
			if services.IsNeedsMFA(err) {
				sendJSON(map[string]any{"type": "needsMFA"})
			} else {
				sendJSON(map[string]any{"type": "error", "message": err.Error()})
			}
			return
		}

		err = services.WatchCluster(ctx, k8sCfg, sess.DisplayLabel(), sendJSON)
		select {
		case <-ctx.Done():
			return
		default:
			if err == nil {
				return
			}
			// Auth errors often mean the short-lived EKS bearer expired mid-stream.
			// Drop only the k8s token first so GetK8sConfig can mint a new one from
			// the still-valid AssumeRole / MFA AWS session. Clearing the AWS cache
			// here would force an MFA prompt every ~14 minutes.
			if isAuthError(err) {
				log.Printf("[SSE] %s auth error: %v", name, err)
				if authRetries >= 1 {
					// Second failure — AWS session itself is likely dead.
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
				log.Printf("[SSE] %s refreshing k8s token and retrying", name)
				select {
				case <-ctx.Done():
					return
				case <-time.After(500 * time.Millisecond):
				}
				continue
			}
			log.Printf("[SSE] %s watch error: %v — reconnecting in 3s", name, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}
}
