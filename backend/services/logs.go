package services

import (
	"bufio"
	"context"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type PodContainersInfo struct {
	Init       []string `json:"init"`
	Containers []string `json:"containers"`
	Current    string   `json:"current"`
	// Running lists container names with state.running (safe to exec into).
	Running []string `json:"running"`
}

func containerStatusRunning(statuses []corev1.ContainerStatus, name string) bool {
	for i := range statuses {
		if statuses[i].Name == name && statuses[i].State.Running != nil {
			return true
		}
	}
	return false
}

// GetPodContainersInfo returns the container list for a pod and picks the
// container to stream. Prefers a running container when preferred is empty
// or not currently running.
func GetPodContainersInfo(ctx context.Context, k8sCfg *rest.Config, namespace, podName, preferredContainer string) (*PodContainersInfo, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	info := &PodContainersInfo{
		Init:       make([]string, 0, len(pod.Spec.InitContainers)),
		Containers: make([]string, 0, len(pod.Spec.Containers)),
		Running:    make([]string, 0, len(pod.Spec.InitContainers)+len(pod.Spec.Containers)),
	}
	for _, c := range pod.Spec.InitContainers {
		info.Init = append(info.Init, c.Name)
		if containerStatusRunning(pod.Status.InitContainerStatuses, c.Name) {
			info.Running = append(info.Running, c.Name)
		}
	}
	for _, c := range pod.Spec.Containers {
		info.Containers = append(info.Containers, c.Name)
		if containerStatusRunning(pod.Status.ContainerStatuses, c.Name) {
			info.Running = append(info.Running, c.Name)
		}
	}

	containerInPod := func(name string) bool {
		for _, n := range info.Init {
			if n == name {
				return true
			}
		}
		for _, n := range info.Containers {
			if n == name {
				return true
			}
		}
		return false
	}

	pickRunningRegular := func() string {
		for _, n := range info.Running {
			for _, c := range info.Containers {
				if c == n {
					return n
				}
			}
		}
		if len(info.Running) > 0 {
			return info.Running[0]
		}
		return ""
	}

	switch {
	case preferredContainer != "" && containerInPod(preferredContainer):
		// Explicit tab selection — include finished init containers.
		info.Current = preferredContainer
	case pickRunningRegular() != "":
		info.Current = pickRunningRegular()
	case len(info.Containers) > 0:
		info.Current = info.Containers[0]
	case len(info.Init) > 0:
		info.Current = info.Init[0]
	}
	return info, nil
}

// StreamPodLogs streams log lines for a pod container.
// Each line is passed to send(); returning false stops the stream.
// If previous is true, returns logs from the previous terminated instance.
func StreamPodLogs(ctx context.Context, k8sCfg *rest.Config, namespace, podName, container string, tail int64, follow, previous bool, send func(line string) bool) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	opts := &corev1.PodLogOptions{
		Container:  container,
		Follow:     follow && !previous, // follow is meaningless for previous terminated logs
		Previous:   previous,
		Timestamps: true,
	}
	if tail > 0 {
		opts.TailLines = &tail
	}
	req := client.CoreV1().Pods(namespace).GetLogs(podName, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return err
	}
	defer stream.Close()
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)
	for scanner.Scan() {
		if !send(scanner.Text()) {
			return nil
		}
	}
	return scanner.Err()
}
