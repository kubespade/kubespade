package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/remotecommand"

	"k8s-client/services"
)

const nodeDebugNamespace = "kube-system"
const nodeDebugImage = "busybox:latest"

// nodeDebugCmd enters all host namespaces via nsenter and spawns bash (or sh fallback).
var nodeDebugCmd = []string{
	"nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
	"/bin/sh", "-c", "[ -x /bin/bash ] && exec /bin/bash || exec /bin/sh",
}

func boolPtr(b bool) *bool { return &b }

func debugPodName(nodeName string) string {
	// Sanitize node name: keep only lowercase alphanum and hyphens, truncate.
	var sb strings.Builder
	for _, ch := range strings.ToLower(nodeName) {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' {
			sb.WriteRune(ch)
			if sb.Len() == 20 {
				break
			}
		}
	}
	return fmt.Sprintf("node-dbg-%s-%08x", sb.String(), rand.Int31())
}

func buildDebugPod(podName, nodeName string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: nodeDebugNamespace,
			Labels:    map[string]string{"app": "k8s-client-node-debug"},
		},
		Spec: corev1.PodSpec{
			NodeName:    nodeName,
			HostPID:     true,
			HostNetwork: true,
			HostIPC:     true,
			Containers: []corev1.Container{
				{
					Name:    "debug",
					Image:   nodeDebugImage,
					Command: []string{"sleep", "1h"},
					SecurityContext: &corev1.SecurityContext{
						Privileged: boolPtr(true),
					},
					Stdin: true,
					TTY:   true,
				},
			},
			Tolerations: []corev1.Toleration{
				{Operator: corev1.TolerationOpExists},
			},
			RestartPolicy: corev1.RestartPolicyNever,
		},
	}
}

func waitForPodRunning(ctx context.Context, client *kubernetes.Clientset, ns, name string) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
			pod, err := client.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				return err
			}
			switch pod.Status.Phase {
			case corev1.PodRunning:
				return nil
			case corev1.PodFailed, corev1.PodSucceeded:
				return fmt.Errorf("pod ended unexpectedly: %s", pod.Status.Phase)
			}
		}
	}
}

// ExecNode creates a privileged busybox debug pod on the target node, waits for
// it to start, execs into it with nsenter to enter host namespaces, then cleans
// up the pod when the session ends.
func ExecNode(c *gin.Context) {
	nodeName := c.Param("nodeName")

	_, _, k8sCfg, ok := resolveK8s(c)
	if !ok {
		return
	}

	client, err := kubernetes.NewForConfig(k8sCfg)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	podName := debugPodName(nodeName)
	pod := buildDebugPod(podName, nodeName)

	createCtx, createCancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer createCancel()

	if _, err := client.CoreV1().Pods(nodeDebugNamespace).Create(createCtx, pod, metav1.CreateOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create debug pod: " + err.Error()})
		return
	}

	// Always clean up the debug pod, regardless of what happens next.
	defer func() {
		delCtx, delCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer delCancel()
		client.CoreV1().Pods(nodeDebugNamespace).Delete(delCtx, podName, metav1.DeleteOptions{}) //nolint:errcheck
	}()

	// Upgrade WebSocket before waiting so the browser knows the session started.
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	// Wait for pod to be Running.
	if err := waitForPodRunning(ctx, client, nodeDebugNamespace, podName); err != nil {
		pkt := append([]byte{3}, []byte("pod not ready: "+err.Error())...)
		conn.WriteMessage(websocket.BinaryMessage, pkt) //nolint:errcheck
		return
	}

	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()
	resizeCh := make(chan remotecommand.TerminalSize, 4)

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
			case 0:
				if _, werr := stdinW.Write(msg[1:]); werr != nil {
					cancel()
					return
				}
			case 2:
				var sz struct {
					W int `json:"w"`
					H int `json:"h"`
				}
				if json.Unmarshal(msg[1:], &sz) == nil && sz.W > 0 && sz.H > 0 {
					select {
					case resizeCh <- remotecommand.TerminalSize{Width: uint16(sz.W), Height: uint16(sz.H)}:
					default:
					}
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

	execErr := services.ExecContainer(ctx, k8sCfg, nodeDebugNamespace, podName, "debug",
		nodeDebugCmd, stdinR, stdoutW, resizeCh)
	stdoutW.Close()

	pkt := []byte{3}
	if execErr != nil && ctx.Err() == nil {
		pkt = append(pkt, []byte(execErr.Error())...)
	}
	conn.WriteMessage(websocket.BinaryMessage, pkt) //nolint:errcheck
}
