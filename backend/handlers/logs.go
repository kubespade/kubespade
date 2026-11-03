package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

// StreamPodLogs is an SSE endpoint that first sends a "containers" message
// with the pod's container list, then streams log lines for the selected
// (or default) container.
//
// Query params:
//
//	namespace   – pod namespace
//	container   – container name (default: first regular container)
//	tail        – number of recent lines to return (default 200)
//	follow      – if "true", keep the stream open for live logs
//	previous    – if "true", return logs from the previous terminated instance
func StreamPodLogs(c *gin.Context) {
	podName := c.Param("podName")
	namespace := c.Query("namespace")
	container := c.Query("container")
	follow := c.Query("follow") == "true"
	previous := c.Query("previous") == "true"

	tail := int64(200)
	if s := c.Query("tail"); s != "" {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil && n > 0 {
			tail = n
		}
	}

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	info, err := services.GetPodContainersInfo(c.Request.Context(), k8sCfg, namespace, podName, container)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	ctx := c.Request.Context()
	flusher, _ := c.Writer.(http.Flusher)

	sendSSE := func(v any) bool {
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

	// First message: container list so the UI can build tabs immediately
	if !sendSSE(map[string]any{
		"type":       "containers",
		"init":       info.Init,
		"containers": info.Containers,
		"current":    info.Current,
	}) {
		return
	}

	if info.Current == "" {
		sendSSE(map[string]any{"type": "error", "message": "pod has no containers"})
		return
	}

	effectiveFollow := follow && !previous
	err = services.StreamPodLogs(ctx, k8sCfg, namespace, podName, info.Current, tail, effectiveFollow, previous, func(line string) bool {
		return sendSSE(map[string]any{"type": "line", "text": line})
	})
	if err != nil && ctx.Err() == nil {
		sendSSE(map[string]any{"type": "error", "message": err.Error()})
		return
	}
	if !effectiveFollow {
		sendSSE(map[string]any{"type": "done"})
	}
}
