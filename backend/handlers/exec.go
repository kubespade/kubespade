package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"k8s-client/services"
	"k8s.io/client-go/tools/remotecommand"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin:     AllowedWebSocketOrigin,
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
}

// GetPodContainers returns {init:[...], containers:[...], current:"..."} for a pod.
func GetPodContainers(c *gin.Context) {
	podName := c.Param("podName")
	namespace := c.Query("namespace")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	info, err := services.GetPodContainersInfo(c.Request.Context(), k8sCfg, namespace, podName, "")
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

// ExecPodContainer upgrades to WebSocket and proxies exec into a pod container.
//
// Binary frame protocol:
//
//	Browser→Backend:  [0, data...]       stdin
//	                  [2, JSON resize]   {"w":cols,"h":rows}
//	Backend→Browser:  [1, data...]       stdout+stderr
//	                  [3, msg...]        exec closed (optional error text)
func ExecPodContainer(c *gin.Context) {
	podName := c.Param("podName")
	namespace := c.Query("namespace")
	container := c.Query("container")
	shellRaw := c.DefaultQuery("shell", "/bin/sh")
	shell, err := services.NormalizeExecShell(shellRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()
	resizeCh := make(chan remotecommand.TerminalSize, 1)
	var resizeMu sync.Mutex
	var pendingResize remotecommand.TerminalSize
	var resizeTimer *time.Timer
	offerResize := func(width, height uint16) {
		resizeMu.Lock()
		defer resizeMu.Unlock()
		pendingResize = remotecommand.TerminalSize{Width: width, Height: height}
		if resizeTimer != nil {
			resizeTimer.Stop()
		}
		resizeTimer = time.AfterFunc(250*time.Millisecond, func() {
			resizeMu.Lock()
			sz := pendingResize
			resizeMu.Unlock()
			select {
			case resizeCh <- sz:
			default:
				select {
				case <-resizeCh:
				default:
				}
				select {
				case resizeCh <- sz:
				default:
				}
			}
		})
	}

	// Browser → exec stdin + resize
	go func() {
		defer stdinW.Close()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				cancel()
				return
			}
			if len(msg) < 1 {
				continue
			}
			switch msg[0] {
			case 0: // stdin
				if _, werr := stdinW.Write(msg[1:]); werr != nil {
					cancel()
					return
				}
			case 2: // resize
				var sz struct {
					W int `json:"w"`
					H int `json:"h"`
				}
				if json.Unmarshal(msg[1:], &sz) == nil && sz.W > 0 && sz.H > 0 {
					offerResize(uint16(sz.W), uint16(sz.H))
				}
			}
		}
	}()

	// exec stdout → browser
	go func() {
		defer stdoutR.Close()
		buf := make([]byte, 32*1024)
		for {
			n, err := stdoutR.Read(buf)
			if n > 0 {
				pkt := make([]byte, 1+n)
				pkt[0] = 1
				copy(pkt[1:], buf[:n])
				if werr := conn.WriteMessage(websocket.BinaryMessage, pkt); werr != nil {
					cancel()
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// Build command: silent cwd OSC hook, then interactive shell (no stdin echo).
	cmd := services.BuildPodExecCommand(shell)

	execErr := services.ExecContainer(ctx, k8sCfg, namespace, podName, container, cmd,
		stdinR, stdoutW, resizeCh)
	stdoutW.Close()

	// Notify client exec ended
	pkt := []byte{3}
	if execErr != nil && ctx.Err() == nil {
		pkt = append(pkt, []byte(execErr.Error())...)
	}
	conn.WriteMessage(websocket.BinaryMessage, pkt) //nolint:errcheck
}
