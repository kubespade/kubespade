package services

import (
	"context"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listHPAs(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, hpa := range list.Items {
		ref := fmt.Sprintf("%s/%s", hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)
		minReplicas := "1"
		if hpa.Spec.MinReplicas != nil {
			minReplicas = fmt.Sprintf("%d", *hpa.Spec.MinReplicas)
		}
		items = append(items, ResourceRow{
			Name:      hpa.Name,
			Namespace: hpa.Namespace,
			Age:       hpa.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"reference":   ref,
				"minReplicas": minReplicas,
				"maxReplicas": fmt.Sprintf("%d", hpa.Spec.MaxReplicas),
				"replicas":    fmt.Sprintf("%d", hpa.Status.CurrentReplicas),
				"metrics":     formatHPAMetricsSummary(hpa.Spec.Metrics, hpa.Status.CurrentMetrics),
			},
		})
	}
	return &ResourceList{Kind: "horizontalpodautoscalers", Items: items}, nil
}

func listPDBs(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.PolicyV1().PodDisruptionBudgets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, pdb := range list.Items {
		availability := ""
		if pdb.Spec.MinAvailable != nil {
			availability = fmt.Sprintf("minAvailable: %s", pdb.Spec.MinAvailable.String())
		} else if pdb.Spec.MaxUnavailable != nil {
			availability = fmt.Sprintf("maxUnavailable: %s", pdb.Spec.MaxUnavailable.String())
		}
		items = append(items, ResourceRow{
			Name:      pdb.Name,
			Namespace: pdb.Namespace,
			Age:       pdb.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"availability":       availability,
				"currentHealthy":     fmt.Sprintf("%d", pdb.Status.CurrentHealthy),
				"disruptionsAllowed": fmt.Sprintf("%d", pdb.Status.DisruptionsAllowed),
			},
		})
	}
	return &ResourceList{Kind: "poddisruptionbudgets", Items: items}, nil
}

func listPriorityClasses(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.SchedulingV1().PriorityClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, pc := range list.Items {
		globalDefault := "false"
		if pc.GlobalDefault {
			globalDefault = "true"
		}
		preemption := "PreemptLowerPriority"
		if pc.PreemptionPolicy != nil {
			preemption = string(*pc.PreemptionPolicy)
		}
		items = append(items, ResourceRow{
			Name: pc.Name,
			Age:  pc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"value":      fmt.Sprintf("%d", pc.Value),
				"global":     globalDefault,
				"preemption": preemption,
			},
		})
	}
	return &ResourceList{Kind: "priorityclasses", Items: items}, nil
}

func listRuntimeClasses(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.NodeV1().RuntimeClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, rc := range list.Items {
		items = append(items, ResourceRow{
			Name: rc.Name,
			Age:  rc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"handler": rc.Handler,
			},
		})
	}
	return &ResourceList{Kind: "runtimeclasses", Items: items}, nil
}

func listLeases(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoordinationV1().Leases(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, l := range list.Items {
		holder := ""
		if l.Spec.HolderIdentity != nil {
			holder = *l.Spec.HolderIdentity
		}
		duration := ""
		if l.Spec.LeaseDurationSeconds != nil {
			duration = fmt.Sprintf("%ds", *l.Spec.LeaseDurationSeconds)
		}
		items = append(items, ResourceRow{
			Name:      l.Name,
			Namespace: l.Namespace,
			Age:       l.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"holder":   holder,
				"duration": duration,
			},
		})
	}
	return &ResourceList{Kind: "leases", Items: items}, nil
}

func listMutatingWebhookConfigs(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.AdmissionregistrationV1().MutatingWebhookConfigurations().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, mwc := range list.Items {
		items = append(items, ResourceRow{
			Name: mwc.Name,
			Age:  mwc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"webhooks": fmt.Sprintf("%d", len(mwc.Webhooks)),
			},
		})
	}
	return &ResourceList{Kind: "mutatingwebhookconfigurations", Items: items}, nil
}

func listValidatingWebhookConfigs(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, vwc := range list.Items {
		items = append(items, ResourceRow{
			Name: vwc.Name,
			Age:  vwc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"webhooks": fmt.Sprintf("%d", len(vwc.Webhooks)),
			},
		})
	}
	return &ResourceList{Kind: "validatingwebhookconfigurations", Items: items}, nil
}

func listCertificateSigningRequests(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.CertificatesV1().CertificateSigningRequests().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, csr := range list.Items {
		condition := "Pending"
		for _, c := range csr.Status.Conditions {
			switch string(c.Type) {
			case "Approved":
				condition = "Approved"
			case "Denied":
				condition = "Denied"
			case "Failed":
				condition = "Failed"
			}
		}
		items = append(items, ResourceRow{
			Name: csr.Name,
			Age:  csr.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"signerName": csr.Spec.SignerName,
				"username":   csr.Spec.Username,
				"condition":  condition,
			},
		})
	}
	return &ResourceList{Kind: "certificatesigningrequests", Items: items}, nil
}

func listFlowSchemas(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.FlowcontrolV1().FlowSchemas().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, fs := range list.Items {
		distinguisher := "ByUser"
		if fs.Spec.DistinguisherMethod != nil {
			distinguisher = string(fs.Spec.DistinguisherMethod.Type)
		}
		items = append(items, ResourceRow{
			Name: fs.Name,
			Age:  fs.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"priorityLevel":       fs.Spec.PriorityLevelConfiguration.Name,
				"matchingPrecedence":  fmt.Sprintf("%d", fs.Spec.MatchingPrecedence),
				"distinguisherMethod": distinguisher,
			},
		})
	}
	return &ResourceList{Kind: "flowschemas", Items: items}, nil
}

func listPriorityLevelConfigurations(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.FlowcontrolV1().PriorityLevelConfigurations().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, plc := range list.Items {
		items = append(items, ResourceRow{
			Name: plc.Name,
			Age:  plc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"type": string(plc.Spec.Type),
			},
		})
	}
	return &ResourceList{Kind: "prioritylevelconfigurations", Items: items}, nil
}

func listValidatingAdmissionPolicies(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.AdmissionregistrationV1().ValidatingAdmissionPolicies().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, vap := range list.Items {
		failurePolicy := "Fail"
		if vap.Spec.FailurePolicy != nil {
			failurePolicy = string(*vap.Spec.FailurePolicy)
		}
		paramKind := "<none>"
		if vap.Spec.ParamKind != nil {
			paramKind = vap.Spec.ParamKind.Kind
		}
		items = append(items, ResourceRow{
			Name: vap.Name,
			Age:  vap.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"failurePolicy": failurePolicy,
				"paramKind":     paramKind,
			},
		})
	}
	return &ResourceList{Kind: "validatingadmissionpolicies", Items: items}, nil
}

func listValidatingAdmissionPolicyBindings(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.AdmissionregistrationV1().ValidatingAdmissionPolicyBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, vapb := range list.Items {
		actions := []string{}
		for _, a := range vapb.Spec.ValidationActions {
			actions = append(actions, string(a))
		}
		actionsStr := strings.Join(actions, ", ")
		if actionsStr == "" {
			actionsStr = "Deny"
		}
		items = append(items, ResourceRow{
			Name: vapb.Name,
			Age:  vapb.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"policyName":        vapb.Spec.PolicyName,
				"validationActions": actionsStr,
			},
		})
	}
	return &ResourceList{Kind: "validatingadmissionpolicybindings", Items: items}, nil
}
