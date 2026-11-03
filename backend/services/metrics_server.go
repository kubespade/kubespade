package services

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const (
	msNamespace  = "kube-system"
	msName       = "metrics-server"
	msImage      = "registry.k8s.io/metrics-server/metrics-server:v0.7.2"
	msAPIService = "v1beta1.metrics.k8s.io"
)

func msLabels() map[string]string {
	return map[string]string{"k8s-app": msName}
}

// metricsServerPresent reports whether a working metrics provider already exists.
// A leftover APIService/Service without a Deployment (e.g. after deleting the deploy)
// must NOT count as present — otherwise EnsureMetricsServer no-ops and never reinstalls.
func metricsServerPresent(ctx context.Context, client *kubernetes.Clientset, k8sCfg *rest.Config) bool {
	dep, err := client.AppsV1().Deployments(msNamespace).Get(ctx, msName, metav1.GetOptions{})
	if err == nil && dep != nil {
		return true
	}

	// Live metrics API (any provider — GKE/EKS addon, etc.)
	_, err = client.Discovery().RESTClient().Get().AbsPath("/apis/metrics.k8s.io/v1beta1").DoRaw(ctx)
	if err == nil {
		return true
	}

	dyn, err := dynamic.NewForConfig(k8sCfg)
	if err != nil {
		return false
	}
	obj, err := dyn.Resource(schema.GroupVersionResource{
		Group: "apiregistration.k8s.io", Version: "v1", Resource: "apiservices",
	}).Get(ctx, msAPIService, metav1.GetOptions{})
	if err != nil {
		return false
	}
	// Only treat as present when the APIService is Available=True.
	conds, found, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	if !found {
		return false
	}
	for _, c := range conds {
		m, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		if m["type"] == "Available" && m["status"] == "True" {
			return true
		}
	}
	return false
}

// EnsureMetricsServer installs upstream metrics-server if missing. No-op when present.
// Called only when enabling the cluster metrics collector.
func EnsureMetricsServer(ctx context.Context, k8sCfg *rest.Config) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	if metricsServerPresent(ctx, client, k8sCfg) {
		return nil
	}

	labels := msLabels()

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: msName, Namespace: msNamespace, Labels: labels},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.CoreV1().ServiceAccounts(msNamespace).Create(ctx, sa, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server SA: %w", err)
	}

	aggCR := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name: "system:aggregated-metrics-reader",
			Labels: map[string]string{
				"k8s-app": msName,
				"rbac.authorization.k8s.io/aggregate-to-admin": "true",
				"rbac.authorization.k8s.io/aggregate-to-edit":  "true",
				"rbac.authorization.k8s.io/aggregate-to-view":  "true",
			},
		},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{"metrics.k8s.io"},
			Resources: []string{"pods", "nodes"},
			Verbs:     []string{"get", "list", "watch"},
		}},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.RbacV1().ClusterRoles().Create(ctx, aggCR, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server aggregated ClusterRole: %w", err)
	}

	msCR := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: "system:metrics-server", Labels: labels},
		Rules: []rbacv1.PolicyRule{
			{APIGroups: []string{""}, Resources: []string{"nodes/metrics"}, Verbs: []string{"get"}},
			{APIGroups: []string{""}, Resources: []string{"pods", "nodes"}, Verbs: []string{"get", "list", "watch"}},
		},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.RbacV1().ClusterRoles().Create(ctx, msCR, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server ClusterRole: %w", err)
	}

	authRB := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "metrics-server-auth-reader", Namespace: msNamespace, Labels: labels},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     "extension-apiserver-authentication-reader",
		},
		Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: msName, Namespace: msNamespace}},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.RbacV1().RoleBindings(msNamespace).Create(ctx, authRB, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server auth RoleBinding: %w", err)
	}

	authDelegator := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "metrics-server:system:auth-delegator", Labels: labels},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "system:auth-delegator",
		},
		Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: msName, Namespace: msNamespace}},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.RbacV1().ClusterRoleBindings().Create(ctx, authDelegator, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server auth-delegator CRB: %w", err)
	}

	msCRB := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "system:metrics-server", Labels: labels},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "system:metrics-server",
		},
		Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: msName, Namespace: msNamespace}},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.RbacV1().ClusterRoleBindings().Create(ctx, msCRB, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server ClusterRoleBinding: %w", err)
	}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: msName, Namespace: msNamespace, Labels: labels},
		Spec: corev1.ServiceSpec{
			Selector: labels,
			Ports: []corev1.ServicePort{{
				Name:       "https",
				Port:       443,
				Protocol:   corev1.ProtocolTCP,
				TargetPort: intstr.FromString("https"),
			}},
		},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.CoreV1().Services(msNamespace).Create(ctx, svc, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server Service: %w", err)
	}

	runAs := int64(1000)
	allowPriv := false
	readOnly := true
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: msName, Namespace: msNamespace, Labels: labels},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Strategy: appsv1.DeploymentStrategy{
				Type: appsv1.RollingUpdateDeploymentStrategyType,
				RollingUpdate: &appsv1.RollingUpdateDeployment{
					MaxUnavailable: intstrPtr(0),
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					ServiceAccountName: msName,
					PriorityClassName:  "system-cluster-critical",
					NodeSelector:       map[string]string{"kubernetes.io/os": "linux"},
					Containers: []corev1.Container{{
						Name:            msName,
						Image:           msImage,
						ImagePullPolicy: corev1.PullIfNotPresent,
						Args: []string{
							"--cert-dir=/tmp",
							"--secure-port=10250",
							"--kubelet-preferred-address-types=InternalIP,ExternalIP,Hostname",
							"--kubelet-use-node-status-port",
							"--metric-resolution=15s",
							"--kubelet-insecure-tls",
						},
						Ports: []corev1.ContainerPort{{
							Name:          "https",
							ContainerPort: 10250,
							Protocol:      corev1.ProtocolTCP,
						}},
						LivenessProbe: &corev1.Probe{
							FailureThreshold: 3,
							PeriodSeconds:    10,
							ProbeHandler: corev1.ProbeHandler{
								HTTPGet: &corev1.HTTPGetAction{
									Path:   "/livez",
									Port:   intstr.FromString("https"),
									Scheme: corev1.URISchemeHTTPS,
								},
							},
						},
						ReadinessProbe: &corev1.Probe{
							FailureThreshold:    3,
							InitialDelaySeconds: 20,
							PeriodSeconds:       10,
							ProbeHandler: corev1.ProbeHandler{
								HTTPGet: &corev1.HTTPGetAction{
									Path:   "/readyz",
									Port:   intstr.FromString("https"),
									Scheme: corev1.URISchemeHTTPS,
								},
							},
						},
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("100m"),
								corev1.ResourceMemory: resource.MustParse("200Mi"),
							},
						},
						SecurityContext: &corev1.SecurityContext{
							AllowPrivilegeEscalation: &allowPriv,
							Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
							ReadOnlyRootFilesystem:   &readOnly,
							RunAsNonRoot:             boolPtr(true),
							RunAsUser:                &runAs,
							SeccompProfile:           &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
						},
						VolumeMounts: []corev1.VolumeMount{{Name: "tmp-dir", MountPath: "/tmp"}},
					}},
					Volumes: []corev1.Volume{{
						Name:         "tmp-dir",
						VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
					}},
				},
			},
		},
	}
	if err := createIgnoreExists(func() error {
		_, e := client.AppsV1().Deployments(msNamespace).Create(ctx, dep, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server Deployment: %w", err)
	}

	dyn, err := dynamic.NewForConfig(k8sCfg)
	if err != nil {
		return err
	}
	apiSvc := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apiregistration.k8s.io/v1",
		"kind":       "APIService",
		"metadata": map[string]interface{}{
			"name":   msAPIService,
			"labels": labels,
		},
		"spec": map[string]interface{}{
			"group":                 "metrics.k8s.io",
			"groupPriorityMinimum":  int64(100),
			"insecureSkipTLSVerify": true,
			"service": map[string]interface{}{
				"name":      msName,
				"namespace": msNamespace,
			},
			"version":         "v1beta1",
			"versionPriority": int64(100),
		},
	}}
	if err := createIgnoreExists(func() error {
		_, e := dyn.Resource(schema.GroupVersionResource{
			Group: "apiregistration.k8s.io", Version: "v1", Resource: "apiservices",
		}).Create(ctx, apiSvc, metav1.CreateOptions{})
		return e
	}); err != nil {
		return fmt.Errorf("metrics-server APIService: %w", err)
	}

	return nil
}

func boolPtr(v bool) *bool { return &v }

func intstrPtr(v int) *intstr.IntOrString {
	x := intstr.FromInt(v)
	return &x
}
