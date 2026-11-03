package services

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"k8s-client/debug"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

type PortForwardSession struct {
	ID            string `json:"id"`
	Profile       string `json:"profile"`
	Namespace     string `json:"namespace"`
	PodName       string `json:"podName"`
	SourceKind    string `json:"sourceKind"`
	SourceName    string `json:"sourceName"`
	LocalPort     int    `json:"localPort"`
	RemotePort    int    `json:"remotePort"`    // port the user selected (service or pod)
	ContainerPort int    `json:"containerPort"` // actual port forwarded into the pod
	Scheme        string `json:"scheme"`        // "http" or "https" for browser open
	StartedAt     int64  `json:"startedAt"`
	stopOnce      sync.Once
	stopCh        chan struct{}
}

func (s *PortForwardSession) Stop() {
	s.stopOnce.Do(func() { close(s.stopCh) })
}

type PortForwardManager struct {
	mu       sync.Mutex
	sessions map[string]*PortForwardSession
}

var DefaultPFManager = &PortForwardManager{
	sessions: make(map[string]*PortForwardSession),
}

func (m *PortForwardManager) List(profile string) []*PortForwardSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]*PortForwardSession, 0)
	for _, s := range m.sessions {
		if s.Profile == profile {
			result = append(result, s)
		}
	}
	// Map iteration order is random — keep UI rows stable across polls.
	sort.Slice(result, func(i, j int) bool {
		if result[i].StartedAt != result[j].StartedAt {
			return result[i].StartedAt < result[j].StartedAt
		}
		return result[i].ID < result[j].ID
	})
	return result
}

// pfParams holds everything needed to (re-)create a port-forwarder.
type pfParams struct {
	k8sCfg     *rest.Config
	namespace  string
	podName    string
	localPort  int
	remotePort int
}

// createForwarder builds a new PortForwarder. The caller is responsible for
// closing stopCh when done. readyCh is fired once the forwarder is listening.
func createForwarder(p pfParams, stopCh <-chan struct{}, readyCh chan struct{}) (*portforward.PortForwarder, *bytes.Buffer, *bytes.Buffer, error) {
	// Long-lived stream: never inherit a per-request Timeout from rest.Config.
	cfg := rest.CopyConfig(p.k8sCfg)
	cfg.Timeout = 0

	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("create k8s client: %w", err)
	}

	transport, upgrader, err := spdy.RoundTripperFor(cfg)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("spdy transport: %w", err)
	}

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(p.namespace).
		Name(p.podName).
		SubResource("portforward")

	url := req.URL()
	spdyDialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, http.MethodPost, url)

	// Prefer WebSocket tunneling (keepalive pings) like kubectl; fall back to SPDY.
	var dialer httpstream.Dialer = spdyDialer
	if wsDialer, wsErr := portforward.NewSPDYOverWebsocketDialer(url, cfg); wsErr == nil {
		dialer = portforward.NewFallbackDialer(wsDialer, spdyDialer, func(err error) bool {
			return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
		})
	}

	var pfOut, pfErr bytes.Buffer
	pf, err := portforward.New(
		dialer,
		[]string{fmt.Sprintf("%d:%d", p.localPort, p.remotePort)},
		stopCh, readyCh, &pfOut, &pfErr,
	)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("create forwarder: %w", err)
	}
	return pf, &pfOut, &pfErr, nil
}

func (m *PortForwardManager) Start(ctx context.Context, k8sCfg *rest.Config, profile, namespace, podName string, localPort, remotePort int) (*PortForwardSession, error) {
	p := pfParams{k8sCfg: k8sCfg, namespace: namespace, podName: podName, localPort: localPort, remotePort: remotePort}

	stopCh := make(chan struct{})
	readyCh := make(chan struct{})

	pf, pfOut, pfErr, err := createForwarder(p, stopCh, readyCh)
	if err != nil {
		close(stopCh)
		return nil, err
	}

	errCh := make(chan error, 1)
	go func() { errCh <- pf.ForwardPorts() }()

	select {
	case <-readyCh:
	case err := <-errCh:
		close(stopCh)
		return nil, fmt.Errorf("port-forward failed: %w (stderr: %s)", err, pfErr.String())
	case <-ctx.Done():
		close(stopCh)
		return nil, ctx.Err()
	}

	// Resolve the actual local port (important when localPort=0)
	actualPorts, _ := pf.GetPorts()
	if len(actualPorts) > 0 {
		p.localPort = int(actualPorts[0].Local)
		localPort = p.localPort
	}

	sess := &PortForwardSession{
		ID:            newSessionID(),
		Profile:       profile,
		Namespace:     namespace,
		PodName:       podName,
		SourceKind:    "pod",
		SourceName:    podName,
		LocalPort:     localPort,
		RemotePort:    remotePort,
		ContainerPort: remotePort,
		Scheme:        suggestScheme(remotePort, remotePort, nil),
		StartedAt:     time.Now().Unix(),
		stopCh:        stopCh,
	}

	debug.Log("PORTFORWARD", fmt.Sprintf("session %s started: %s/%s %d→%d",
		sess.ID, namespace, podName, localPort, remotePort))

	m.mu.Lock()
	m.sessions[sess.ID] = sess
	m.mu.Unlock()

	_ = pfOut // stdout unused; keepAlive only logs stderr from the active forwarder
	go m.keepAlive(sess, p, errCh, pfErr)

	return sess, nil
}

// keepAlive monitors the active port-forward and transparently reconnects on
// transient failures (e.g. "lost connection to pod"). It gives up only when
// the session is explicitly stopped or after maxAttempts consecutive failures.
// pfErr is swapped on each successful recreate so disconnect logs show the
// current forwarder's stderr (not a stale buffer from the first connection).
func (m *PortForwardManager) keepAlive(sess *PortForwardSession, p pfParams, firstErrCh <-chan error, pfErr *bytes.Buffer) {
	const maxAttempts = 10
	const retryDelay = 2 * time.Second

	errCh := firstErrCh
	attempt := 0

	for {
		select {
		case err := <-errCh:
			// Check whether the session was explicitly stopped.
			select {
			case <-sess.stopCh:
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s stopped via explicit Stop()", sess.ID))
				m.removeSession(sess.ID)
				return
			default:
			}

			if err != nil {
				debug.Log("PORTFORWARD", fmt.Sprintf(
					"session %s disconnected (attempt %d/%d): %v | stderr: %s",
					sess.ID, attempt+1, maxAttempts, err, pfErr.String()))
			} else {
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s closed cleanly, reconnecting…", sess.ID))
			}

			attempt++
			if attempt >= maxAttempts {
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s permanently failed after %d attempts", sess.ID, maxAttempts))
				m.removeSession(sess.ID)
				return
			}

			// Wait before reconnecting, but bail out immediately if stopped.
			select {
			case <-sess.stopCh:
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s stopped during retry wait", sess.ID))
				m.removeSession(sess.ID)
				return
			case <-time.After(retryDelay):
			}

			debug.Log("PORTFORWARD", fmt.Sprintf("session %s reconnecting…", sess.ID))

			newReadyCh := make(chan struct{})
			newPF, _, newErrBuf, createErr := createForwarder(p, sess.stopCh, newReadyCh)
			if createErr != nil {
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s failed to recreate forwarder: %v", sess.ID, createErr))
				// count this as another attempt and loop back
				newErrCh := make(chan error, 1)
				newErrCh <- createErr
				errCh = newErrCh
				pfErr = new(bytes.Buffer)
				continue
			}

			newErrCh := make(chan error, 1)
			go func() { newErrCh <- newPF.ForwardPorts() }()

			// Wait for the new forwarder to become ready.
			select {
			case <-newReadyCh:
				attempt = 0 // reset on successful reconnect
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s reconnected successfully", sess.ID))
			case startErr := <-newErrCh:
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s failed to reconnect: %v", sess.ID, startErr))
				newErrCh2 := make(chan error, 1)
				newErrCh2 <- startErr
				newErrCh = newErrCh2
			case <-sess.stopCh:
				debug.Log("PORTFORWARD", fmt.Sprintf("session %s stopped during reconnect", sess.ID))
				m.removeSession(sess.ID)
				return
			}

			errCh = newErrCh
			pfErr = newErrBuf

		case <-sess.stopCh:
			debug.Log("PORTFORWARD", fmt.Sprintf("session %s stopped via explicit Stop()", sess.ID))
			m.removeSession(sess.ID)
			return
		}
	}
}

func (m *PortForwardManager) removeSession(id string) {
	m.mu.Lock()
	delete(m.sessions, id)
	m.mu.Unlock()
}

func (m *PortForwardManager) Stop(id string) bool {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return false
	}
	sess.Stop()
	return true
}

func newSessionID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// resolveServiceTargetPort maps a Service port to the container port on the pod
// (same logic as kubectl port-forward service/...).
func resolveServiceTargetPort(svc *corev1.Service, pod *corev1.Pod, servicePort int) (int, error) {
	var matched *corev1.ServicePort
	for i := range svc.Spec.Ports {
		if int(svc.Spec.Ports[i].Port) == servicePort {
			matched = &svc.Spec.Ports[i]
			break
		}
	}
	if matched == nil {
		// Not a declared Service port — treat as an explicit container port.
		return servicePort, nil
	}

	tp := matched.TargetPort
	if tp.Type == intstr.Int {
		if tp.IntVal == 0 {
			return int(matched.Port), nil
		}
		return int(tp.IntVal), nil
	}

	name := tp.StrVal
	if name == "" {
		return int(matched.Port), nil
	}
	for _, c := range pod.Spec.Containers {
		for _, p := range c.Ports {
			if p.Name == name {
				return int(p.ContainerPort), nil
			}
		}
	}
	return 0, fmt.Errorf("named targetPort %q not found on pod %s", name, pod.Name)
}

// StartForService finds a running pod backing the service and starts a port-forward to it.
func (m *PortForwardManager) StartForService(ctx context.Context, k8sCfg *rest.Config, profile, namespace, serviceName string, localPort, remotePort int) (*PortForwardSession, error) {
	client, err := kubernetes.NewForConfig(k8sCfg)
	if err != nil {
		return nil, err
	}

	svc, err := client.CoreV1().Services(namespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get service: %w", err)
	}
	if len(svc.Spec.Selector) == 0 {
		return nil, fmt.Errorf("service %s has no pod selector (headless or external)", serviceName)
	}

	sel := labels.Set(svc.Spec.Selector).String()
	podList, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel})
	if err != nil {
		return nil, fmt.Errorf("list pods: %w", err)
	}

	var target *corev1.Pod
	for i := range podList.Items {
		if podList.Items[i].Status.Phase == corev1.PodRunning {
			target = &podList.Items[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("no running pods found for service %s", serviceName)
	}

	containerPort, err := resolveServiceTargetPort(svc, target, remotePort)
	if err != nil {
		return nil, err
	}
	if containerPort != remotePort {
		debug.Log("PORTFORWARD", fmt.Sprintf("service %s/%s port %d → container port %d on pod %s",
			namespace, serviceName, remotePort, containerPort, target.Name))
	}

	sess, err := m.Start(ctx, k8sCfg, profile, namespace, target.Name, localPort, containerPort)
	if err != nil {
		return nil, err
	}
	sess.SourceKind = "service"
	sess.SourceName = serviceName
	// Keep the service port the user selected for UI display.
	sess.RemotePort = remotePort
	sess.ContainerPort = containerPort
	sess.Scheme = suggestScheme(remotePort, containerPort, target)
	debug.Log("PORTFORWARD", fmt.Sprintf("session %s scheme=%s (service port %d → container %d)",
		sess.ID, sess.Scheme, remotePort, containerPort))
	return sess, nil
}

func isTLSPort(port int) bool {
	switch port {
	case 443, 8443, 9443, 6443:
		return true
	default:
		return false
	}
}

// podPlainHTTP reports whether the pod is known to speak plain HTTP on its
// main port (e.g. Argo CD with --insecure). Opening https:// against such a
// port makes client-go tear down the entire port-forward on the first connection.
func podPlainHTTP(pod *corev1.Pod) bool {
	if pod == nil {
		return false
	}
	for _, c := range pod.Spec.Containers {
		args := append(append([]string{}, c.Command...), c.Args...)
		for _, a := range args {
			if a == "--insecure" || a == "--insecure=true" {
				return true
			}
			if strings.HasPrefix(a, "--insecure=") && strings.Contains(strings.ToLower(a), "true") {
				return true
			}
		}
		for _, e := range c.Env {
			switch e.Name {
			case "ARGOCD_SERVER_INSECURE", "SERVER_INSECURE":
				v := strings.ToLower(e.Value)
				if v == "true" || v == "1" || v == "yes" {
					return true
				}
			}
		}
	}
	return false
}

// suggestScheme picks http/https for "Open in browser".
// Wrong scheme against the container kills the whole port-forward (client-go closes
// the SPDY/WS connection on any stream error).
func suggestScheme(requestedPort, containerPort int, pod *corev1.Pod) string {
	if podPlainHTTP(pod) {
		return "http"
	}
	if isTLSPort(containerPort) {
		return "https"
	}
	// Service port 443 often remaps to container 8080. Without --insecure the
	// process still speaks TLS on 8080 (Argo CD default) — prefer https.
	if isTLSPort(requestedPort) {
		return "https"
	}
	return "http"
}
