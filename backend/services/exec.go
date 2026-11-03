package services

import (
	"context"
	"io"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

type termResizeQueue struct {
	ch  <-chan remotecommand.TerminalSize
	ctx context.Context
}

func (q *termResizeQueue) Next() *remotecommand.TerminalSize {
	select {
	case sz, ok := <-q.ch:
		if !ok {
			return nil
		}
		return &sz
	case <-q.ctx.Done():
		return nil
	}
}

func ExecContainer(
	ctx context.Context,
	k8sCfg *rest.Config,
	namespace, podName, container string,
	cmd []string,
	stdin io.Reader,
	stdout io.Writer,
	resizeCh chan remotecommand.TerminalSize,
) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec")

	req.VersionedParams(&corev1.PodExecOptions{
		Container: container,
		Command:   cmd,
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
		TTY:       true,
	}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(k8sCfg, "POST", req.URL())
	if err != nil {
		return err
	}

	rq := &termResizeQueue{ch: resizeCh, ctx: ctx}

	return executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             stdin,
		Stdout:            stdout,
		Stderr:            stdout,
		Tty:               true,
		TerminalSizeQueue: rq,
	})
}
