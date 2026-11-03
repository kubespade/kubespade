package services

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type NodeTaint struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Effect string `json:"effect"`
}

func ListNodeTaints(ctx context.Context, k8sCfg *rest.Config, nodeName string) ([]NodeTaint, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	node, err := client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return taintsFromNode(node), nil
}

func AddNodeTaint(ctx context.Context, k8sCfg *rest.Config, nodeName, key, value, effect string) error {
	if key == "" {
		return fmt.Errorf("taint key is required")
	}
	eff, err := parseTaintEffect(effect)
	if err != nil {
		return err
	}

	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	node, err := client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return err
	}

	updated := false
	for i := range node.Spec.Taints {
		t := &node.Spec.Taints[i]
		if t.Key == key && t.Effect == eff {
			t.Value = value
			updated = true
			break
		}
	}
	if !updated {
		node.Spec.Taints = append(node.Spec.Taints, corev1.Taint{
			Key:    key,
			Value:  value,
			Effect: eff,
		})
	}

	_, err = client.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{})
	return err
}

func RemoveNodeTaint(ctx context.Context, k8sCfg *rest.Config, nodeName, key, effect string) error {
	if key == "" {
		return fmt.Errorf("taint key is required")
	}
	eff, err := parseTaintEffect(effect)
	if err != nil {
		return err
	}

	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	node, err := client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return err
	}

	filtered := make([]corev1.Taint, 0, len(node.Spec.Taints))
	found := false
	for _, t := range node.Spec.Taints {
		if t.Key == key && t.Effect == eff {
			found = true
			continue
		}
		filtered = append(filtered, t)
	}
	if !found {
		return fmt.Errorf("taint %s:%s not found on node %q", key, effect, nodeName)
	}
	node.Spec.Taints = filtered

	_, err = client.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{})
	return err
}

func taintsFromNode(node *corev1.Node) []NodeTaint {
	out := make([]NodeTaint, 0, len(node.Spec.Taints))
	for _, t := range node.Spec.Taints {
		out = append(out, NodeTaint{
			Key:    t.Key,
			Value:  t.Value,
			Effect: string(t.Effect),
		})
	}
	return out
}

func parseTaintEffect(effect string) (corev1.TaintEffect, error) {
	switch corev1.TaintEffect(effect) {
	case corev1.TaintEffectNoSchedule, corev1.TaintEffectPreferNoSchedule, corev1.TaintEffectNoExecute:
		return corev1.TaintEffect(effect), nil
	default:
		return "", fmt.Errorf("invalid effect %q (want NoSchedule, PreferNoSchedule, or NoExecute)", effect)
	}
}
