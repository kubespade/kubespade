package services

import (
	"context"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type ResourceRow struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace,omitempty"`
	Age       int64             `json:"age"` // Unix seconds of creation
	Fields    map[string]string `json:"fields"`
}

// ResourceColumn describes a dynamic table column (CRD additionalPrinterColumns).
type ResourceColumn struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Priority int32  `json:"priority"` // >0 → hidden by default (kubectl-style)
}

type ResourceList struct {
	Kind    string           `json:"kind"`
	Items   []ResourceRow    `json:"items"`
	Columns []ResourceColumn `json:"columns,omitempty"`
}

func ListResources(ctx context.Context, k8sCfg *rest.Config, kind, namespace string) (*ResourceList, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, fmt.Errorf("create k8s client: %w", err)
	}
	return listByKind(ctx, client, kind, namespace)
}

func listByKind(ctx context.Context, client *kubernetes.Clientset, kind, namespace string) (*ResourceList, error) {
	switch kind {
	case "pods":
		return listPods(ctx, client, namespace)
	case "deployments":
		return listDeployments(ctx, client, namespace)
	case "daemonsets":
		return listDaemonSets(ctx, client, namespace)
	case "statefulsets":
		return listStatefulSets(ctx, client, namespace)
	case "jobs":
		return listJobs(ctx, client, namespace)
	case "cronjobs":
		return listCronJobs(ctx, client, namespace)
	case "services":
		return listServices(ctx, client, namespace)
	case "ingresses":
		return listIngresses(ctx, client, namespace)
	case "persistentvolumeclaims":
		return listPVCs(ctx, client, namespace)
	case "configmaps":
		return listConfigMaps(ctx, client, namespace)
	case "secrets":
		return listSecrets(ctx, client, namespace)
	case "replicasets":
		return listReplicaSets(ctx, client, namespace)
	case "replicationcontrollers":
		return listReplicationControllers(ctx, client, namespace)
	case "persistentvolumes":
		return listPersistentVolumes(ctx, client, namespace)
	case "storageclasses":
		return listStorageClasses(ctx, client, namespace)
	case "endpointslices":
		return listEndpointSlices(ctx, client, namespace)
	case "endpoints":
		return listEndpoints(ctx, client, namespace)
	case "ingressclasses":
		return listIngressClasses(ctx, client, namespace)
	case "networkpolicies":
		return listNetworkPolicies(ctx, client, namespace)
	case "resourcequotas":
		return listResourceQuotas(ctx, client, namespace)
	case "limitranges":
		return listLimitRanges(ctx, client, namespace)
	case "horizontalpodautoscalers":
		return listHPAs(ctx, client, namespace)
	case "poddisruptionbudgets":
		return listPDBs(ctx, client, namespace)
	case "priorityclasses":
		return listPriorityClasses(ctx, client, namespace)
	case "runtimeclasses":
		return listRuntimeClasses(ctx, client, namespace)
	case "leases":
		return listLeases(ctx, client, namespace)
	case "mutatingwebhookconfigurations":
		return listMutatingWebhookConfigs(ctx, client, namespace)
	case "validatingwebhookconfigurations":
		return listValidatingWebhookConfigs(ctx, client, namespace)
	case "serviceaccounts":
		return listServiceAccounts(ctx, client, namespace)
	case "clusterroles":
		return listClusterRoles(ctx, client, namespace)
	case "roles":
		return listRoles(ctx, client, namespace)
	case "clusterrolebindings":
		return listClusterRoleBindings(ctx, client, namespace)
	case "rolebindings":
		return listRoleBindings(ctx, client, namespace)
	case "namespaces":
		return listNamespaces(ctx, client, namespace)
	case "events":
		return listEvents(ctx, client, namespace)
	case "certificatesigningrequests":
		return listCertificateSigningRequests(ctx, client, namespace)
	case "csidrivers":
		return listCSIDrivers(ctx, client, namespace)
	case "csinodes":
		return listCSINodes(ctx, client, namespace)
	case "volumeattachments":
		return listVolumeAttachments(ctx, client, namespace)
	case "csistoragecapacities":
		return listCSIStorageCapacities(ctx, client, namespace)
	case "flowschemas":
		return listFlowSchemas(ctx, client, namespace)
	case "prioritylevelconfigurations":
		return listPriorityLevelConfigurations(ctx, client, namespace)
	case "validatingadmissionpolicies":
		return listValidatingAdmissionPolicies(ctx, client, namespace)
	case "validatingadmissionpolicybindings":
		return listValidatingAdmissionPolicyBindings(ctx, client, namespace)
	default:
		return nil, fmt.Errorf("unknown resource kind: %s", kind)
	}
}

func containerDotColor(cs corev1.ContainerStatus) string {
	if cs.State.Running != nil && cs.Ready {
		return "g"
	}
	if cs.State.Terminated != nil {
		if cs.State.Terminated.ExitCode == 0 {
			return "s" // completed successfully → gray
		}
		return "r"
	}
	if cs.State.Waiting != nil {
		switch cs.State.Waiting.Reason {
		case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull",
			"OOMKilled", "Error", "CreateContainerConfigError", "CreateContainerError":
			return "r"
		}
	}
	if cs.State.Running != nil {
		return "y" // running but not ready yet
	}
	return "y"
}

// computePodStatus mirrors the logic used by kubectl / Lens.
// Priority: Terminating → init containers → container states → phase+readiness.
func computePodStatus(p corev1.Pod) string {
	if p.DeletionTimestamp != nil {
		return "Terminating"
	}
	if p.Status.Reason == "Evicted" {
		return "Evicted"
	}

	// Init containers — iterate until we find one that is not successfully finished.
	for i, cs := range p.Status.InitContainerStatuses {
		if cs.State.Terminated != nil && cs.State.Terminated.ExitCode == 0 {
			continue // regular init: completed successfully
		}
		if cs.Ready {
			continue // sidecar init (restartPolicy: Always): running and ready
		}
		if cs.State.Terminated != nil {
			reason := cs.State.Terminated.Reason
			if reason == "" {
				reason = fmt.Sprintf("ExitCode:%d", cs.State.Terminated.ExitCode)
			}
			return "Init:" + reason
		}
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" && cs.State.Waiting.Reason != "PodInitializing" {
			return "Init:" + cs.State.Waiting.Reason
		}
		// Running or Waiting with no reason — still initialising.
		return fmt.Sprintf("Init:%d/%d", i, len(p.Spec.InitContainers))
	}

	// Regular containers — prefer explicit waiting/terminated reasons.
	for _, cs := range p.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason // CrashLoopBackOff, ImagePullBackOff, …
		}
		if cs.State.Terminated != nil && cs.State.Terminated.ExitCode != 0 {
			reason := cs.State.Terminated.Reason
			if reason == "" {
				reason = fmt.Sprintf("ExitCode:%d", cs.State.Terminated.ExitCode)
			}
			return reason
		}
	}

	phase := string(p.Status.Phase)
	if phase == "" {
		return "Unknown"
	}

	// "Running" only when the pod has actually passed its readiness probe.
	// Before that — containers started but not yet serving traffic → NotReady.
	if phase == "Running" && !isPodReady(p) {
		return "NotReady"
	}

	return phase
}

func isPodReady(p corev1.Pod) bool {
	for _, c := range p.Status.Conditions {
		if c.Type == corev1.PodReady {
			return c.Status == corev1.ConditionTrue
		}
	}
	return false
}

func minInt32(a, b int32) int32 {
	if a < b {
		return a
	}
	return b
}

func deploymentStatus(s appsv1.DeploymentStatus, desired int32) string {
	for _, c := range s.Conditions {
		if c.Type == appsv1.DeploymentProgressing && c.Reason == "ProgressDeadlineExceeded" {
			return "Failed"
		}
	}
	if desired == 0 {
		return "Scaled Down"
	}
	if s.ReadyReplicas == desired && s.UpdatedReplicas == desired && s.AvailableReplicas == desired {
		return "Ready"
	}
	if s.UpdatedReplicas < desired {
		if s.ReadyReplicas >= desired {
			return "Rolling"
		}
		return "Progressing"
	}
	if s.ReadyReplicas == 0 {
		return "Unavailable"
	}
	if s.ReadyReplicas < desired {
		return "Degraded"
	}
	return "Ready"
}

func formatHPAMetricTarget(t autoscalingv2.MetricTarget) string {
	switch t.Type {
	case autoscalingv2.UtilizationMetricType:
		if t.AverageUtilization != nil {
			return fmt.Sprintf("%d%%", *t.AverageUtilization)
		}
	case autoscalingv2.AverageValueMetricType:
		if t.AverageValue != nil {
			return t.AverageValue.String()
		}
	case autoscalingv2.ValueMetricType:
		if t.Value != nil {
			return t.Value.String()
		}
	}
	if t.AverageUtilization != nil {
		return fmt.Sprintf("%d%%", *t.AverageUtilization)
	}
	if t.AverageValue != nil {
		return t.AverageValue.String()
	}
	if t.Value != nil {
		return t.Value.String()
	}
	return "—"
}

func formatHPAMetricCurrent(c autoscalingv2.MetricValueStatus) string {
	// List view: prefer utilization % only — raw quantities live in the detail panel.
	if c.AverageUtilization != nil {
		return fmt.Sprintf("%d%%", *c.AverageUtilization)
	}
	if c.AverageValue != nil {
		return c.AverageValue.String()
	}
	if c.Value != nil {
		return c.Value.String()
	}
	return "—"
}

func shortHPAListName(name string, typ autoscalingv2.MetricSourceType) string {
	switch typ {
	case autoscalingv2.ResourceMetricSourceType, autoscalingv2.ContainerResourceMetricSourceType:
		if name == "memory" {
			return "mem"
		}
		// Drop "cpu (sidecar)" container suffix noise in the table.
		if i := strings.Index(name, " ("); i > 0 {
			name = name[:i]
		}
		return name
	}
	const max = 18
	if len(name) <= max {
		return name
	}
	return name[:8] + "…" + name[len(name)-7:]
}

func hpaMetricSpecParts(m autoscalingv2.MetricSpec) (name, target, key string) {
	switch m.Type {
	case autoscalingv2.ResourceMetricSourceType:
		if m.Resource != nil {
			name = string(m.Resource.Name)
			target = formatHPAMetricTarget(m.Resource.Target)
			key = "Resource:" + name
			return
		}
	case autoscalingv2.ContainerResourceMetricSourceType:
		if m.ContainerResource != nil {
			name = string(m.ContainerResource.Name)
			if m.ContainerResource.Container != "" {
				name = fmt.Sprintf("%s (%s)", name, m.ContainerResource.Container)
			}
			target = formatHPAMetricTarget(m.ContainerResource.Target)
			key = "ContainerResource:" + name
			return
		}
	case autoscalingv2.PodsMetricSourceType:
		if m.Pods != nil {
			name = m.Pods.Metric.Name
			target = formatHPAMetricTarget(m.Pods.Target)
			key = "Pods:" + name
			return
		}
	case autoscalingv2.ObjectMetricSourceType:
		if m.Object != nil {
			name = m.Object.Metric.Name
			target = formatHPAMetricTarget(m.Object.Target)
			key = "Object:" + name
			return
		}
	case autoscalingv2.ExternalMetricSourceType:
		if m.External != nil {
			name = m.External.Metric.Name
			target = formatHPAMetricTarget(m.External.Target)
			key = "External:" + name
			return
		}
	}
	name = string(m.Type)
	target = "—"
	key = string(m.Type) + ":"
	return
}

func hpaMetricStatusParts(m autoscalingv2.MetricStatus) (name, current, key string) {
	switch m.Type {
	case autoscalingv2.ResourceMetricSourceType:
		if m.Resource != nil {
			name = string(m.Resource.Name)
			current = formatHPAMetricCurrent(m.Resource.Current)
			key = "Resource:" + name
			return
		}
	case autoscalingv2.ContainerResourceMetricSourceType:
		if m.ContainerResource != nil {
			name = string(m.ContainerResource.Name)
			if m.ContainerResource.Container != "" {
				name = fmt.Sprintf("%s (%s)", name, m.ContainerResource.Container)
			}
			current = formatHPAMetricCurrent(m.ContainerResource.Current)
			key = "ContainerResource:" + name
			return
		}
	case autoscalingv2.PodsMetricSourceType:
		if m.Pods != nil {
			name = m.Pods.Metric.Name
			current = formatHPAMetricCurrent(m.Pods.Current)
			key = "Pods:" + name
			return
		}
	case autoscalingv2.ObjectMetricSourceType:
		if m.Object != nil {
			name = m.Object.Metric.Name
			current = formatHPAMetricCurrent(m.Object.Current)
			key = "Object:" + name
			return
		}
	case autoscalingv2.ExternalMetricSourceType:
		if m.External != nil {
			name = m.External.Metric.Name
			current = formatHPAMetricCurrent(m.External.Current)
			key = "External:" + name
			return
		}
	}
	name = string(m.Type)
	current = "—"
	key = string(m.Type) + ":"
	return
}

func formatHPAMetricsSummary(specs []autoscalingv2.MetricSpec, status []autoscalingv2.MetricStatus) string {
	currentByKey := make(map[string]string, len(status))
	for _, s := range status {
		_, current, key := hpaMetricStatusParts(s)
		currentByKey[key] = current
	}
	parts := make([]string, 0, len(specs))
	for _, m := range specs {
		name, target, key := hpaMetricSpecParts(m)
		current := currentByKey[key]
		if current == "" {
			current = "—"
		}
		parts = append(parts, fmt.Sprintf("%s %s/%s", shortHPAListName(name, m.Type), current, target))
	}
	if len(parts) == 0 {
		return "—"
	}
	return strings.Join(parts, "\n")
}
