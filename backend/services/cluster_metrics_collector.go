package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	rest "k8s.io/client-go/rest"
)

const (
	CMCNamespace          = "kubespade"
	CMCName               = "kubespade-metrics"
	CMCAppLabel           = "kubespade-metrics"
	CMCPort               = 8080
	CMCManifestVersion    = 2
	CMCManifestVersionAnn = "kubespade/manifest-version"
	CMCManagedBy          = "kubespade"
	CMCAnnRetentionDays   = "kubespade/retention-days"
	CMCAnnStorage         = "kubespade/storage"
	CMCAnnRestartedAt     = "kubespade/restarted-at"
)

var CMCRetentionOptions = []int{7, 14, 30}

const CMCDefaultRetention = 14

type CmcStatus struct {
	State           string                 `json:"state"`
	RetentionDays   *int                   `json:"retentionDays,omitempty"`
	ReadyReplicas   *int32                 `json:"readyReplicas,omitempty"`
	Message         string                 `json:"message,omitempty"`
	ManifestVersion *int                   `json:"manifestVersion,omitempty"`
	UpdateAvailable bool                   `json:"updateAvailable,omitempty"`
	Meta            map[string]interface{} `json:"meta,omitempty"`
}

func installedManifestVersion(annotations map[string]string) int {
	raw := annotations[CMCManifestVersionAnn]
	if raw == "" {
		return 1 // pre-annotation installs = v1
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 1
	}
	return n
}

func withVersionFields(st *CmcStatus, annotations map[string]string) *CmcStatus {
	v := installedManifestVersion(annotations)
	st.ManifestVersion = &v
	st.UpdateAvailable = v < CMCManifestVersion
	return st
}

func NormalizeRetention(days int) int {
	for _, d := range CMCRetentionOptions {
		if d == days {
			return d
		}
	}
	return CMCDefaultRetention
}

func cmcLabels() map[string]string {
	return map[string]string{
		"app":                          CMCAppLabel,
		"app.kubernetes.io/name":       CMCName,
		"app.kubernetes.io/managed-by": CMCManagedBy,
	}
}

func resolveStorageClassName(ctx context.Context, client *kubernetes.Clientset) (string, error) {
	list, err := client.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", err
	}
	if len(list.Items) == 0 {
		return "", nil
	}
	byName := map[string]string{}
	var names []string
	for _, sc := range list.Items {
		l := strings.ToLower(sc.Name)
		byName[l] = sc.Name
		names = append(names, sc.Name)
	}
	// Prefer gp3 over cluster default (EKS default is often still gp2).
	if n := pickGp3StorageClass(names); n != "" {
		return n, nil
	}
	for _, sc := range list.Items {
		if strings.EqualFold(sc.Annotations["storageclass.kubernetes.io/is-default-class"], "true") {
			return sc.Name, nil
		}
	}
	preferred := []string{"standard", "default", "gp2", "local-path", "hostpath", "standard-rwo", "csi-hostpath-sc"}
	for _, p := range preferred {
		if n, ok := byName[p]; ok {
			return n, nil
		}
	}
	return list.Items[0].Name, nil
}

func pickGp3StorageClass(names []string) string {
	var candidates []string
	for _, n := range names {
		l := strings.ToLower(n)
		if l == "gp3" {
			return n
		}
		if strings.Contains(l, "gp3") {
			candidates = append(candidates, n)
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	best := candidates[0]
	for _, n := range candidates[1:] {
		if len(n) < len(best) {
			best = n
		}
	}
	return best
}

func proxyCollector(ctx context.Context, client *kubernetes.Clientset, path string) ([]byte, error) {
	return client.CoreV1().Services(CMCNamespace).ProxyGet(
		"http", CMCName, strconv.Itoa(CMCPort), path, nil,
	).DoRaw(ctx)
}

func pendingHint(ctx context.Context, client *kubernetes.Clientset) string {
	pods, err := client.CoreV1().Pods(CMCNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app=" + CMCAppLabel,
	})
	if err == nil && len(pods.Items) > 0 {
		pod := pods.Items[0]
		for _, c := range pod.Status.Conditions {
			if c.Type == corev1.PodScheduled && c.Status == corev1.ConditionFalse && c.Message != "" {
				return c.Message
			}
		}
		for _, cs := range append(pod.Status.ContainerStatuses, pod.Status.InitContainerStatuses...) {
			if cs.State.Waiting != nil {
				if cs.State.Waiting.Message != "" {
					return cs.State.Waiting.Message
				}
				if cs.State.Waiting.Reason != "" {
					return cs.State.Waiting.Reason
				}
			}
		}
	}
	pvc, err := client.CoreV1().PersistentVolumeClaims(CMCNamespace).Get(ctx, CMCName+"-data", metav1.GetOptions{})
	if err == nil && pvc.Status.Phase != corev1.ClaimBound {
		sc := "(none)"
		if pvc.Spec.StorageClassName != nil && *pvc.Spec.StorageClassName != "" {
			sc = *pvc.Spec.StorageClassName
		}
		return fmt.Sprintf("PVC %s, StorageClass=%s", pvc.Status.Phase, sc)
	}
	return ""
}

/** Deploy may already be gone while pods/namespace are still Terminating. */
func collectorTeardownStatus(ctx context.Context, client kubernetes.Interface) *CmcStatus {
	ns, err := client.CoreV1().Namespaces().Get(ctx, CMCNamespace, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			return nil
		}
		return nil
	}
	if ns.DeletionTimestamp != nil || ns.Status.Phase == corev1.NamespaceTerminating {
		return &CmcStatus{State: "pending", Message: "Removing…"}
	}

	pods, err := client.CoreV1().Pods(CMCNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app=" + CMCAppLabel,
	})
	if err == nil && len(pods.Items) > 0 {
		return &CmcStatus{State: "pending", Message: "Removing…"}
	}

	pvc, err := client.CoreV1().PersistentVolumeClaims(CMCNamespace).Get(ctx, CMCName+"-data", metav1.GetOptions{})
	if err == nil && pvc.DeletionTimestamp != nil {
		return &CmcStatus{State: "pending", Message: "Removing…"}
	}
	return nil
}

func GetCollectorStatus(ctx context.Context, k8sCfg *rest.Config) (*CmcStatus, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	dep, err := client.AppsV1().Deployments(CMCNamespace).Get(ctx, CMCName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			if st := collectorTeardownStatus(ctx, client); st != nil {
				return st, nil
			}
			return &CmcStatus{State: "missing", Message: "Collector not installed in this cluster"}, nil
		}
		return &CmcStatus{State: "error", Message: err.Error()}, nil
	}

	ready := dep.Status.ReadyReplicas
	desired := int32(1)
	if dep.Spec.Replicas != nil {
		desired = *dep.Spec.Replicas
	}
	var retention *int
	if v := dep.Annotations[CMCAnnRetentionDays]; v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 {
			retention = &n
		}
	}

	ann := dep.Annotations
	if ann == nil {
		ann = map[string]string{}
	}

	if dep.DeletionTimestamp != nil {
		return withVersionFields(&CmcStatus{
			State:         "pending",
			RetentionDays: retention,
			ReadyReplicas: &ready,
			Message:       "Removing…",
		}, ann), nil
	}

	if ready < 1 {
		msg := pendingHint(ctx, client)
		if msg == "" {
			msg = fmt.Sprintf("Waiting for pod (%d/%d ready)", ready, desired)
		}
		return withVersionFields(&CmcStatus{
			State:         "pending",
			RetentionDays: retention,
			ReadyReplicas: &ready,
			Message:       msg,
		}, ann), nil
	}

	healthCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	raw, err := proxyCollector(healthCtx, client, "/health")
	if err != nil {
		return withVersionFields(&CmcStatus{
			State:         "running",
			RetentionDays: retention,
			ReadyReplicas: &ready,
			Message:       "Pod ready — proxy warming up",
		}, ann), nil
	}
	var health struct {
		OK bool `json:"ok"`
	}
	_ = json.Unmarshal(raw, &health)
	if !health.OK {
		return withVersionFields(&CmcStatus{
			State:         "pending",
			RetentionDays: retention,
			ReadyReplicas: &ready,
			Message:       "Health check failed",
		}, ann), nil
	}

	metaCtx, cancelMeta := context.WithTimeout(ctx, 2*time.Second)
	defer cancelMeta()
	metaRaw, err := proxyCollector(metaCtx, client, "/v1/meta")
	if err == nil {
		var meta map[string]interface{}
		if json.Unmarshal(metaRaw, &meta) == nil {
			if rd, ok := meta["retentionDays"].(float64); ok {
				n := int(rd)
				retention = &n
			}
			return withVersionFields(&CmcStatus{
				State:         "running",
				RetentionDays: retention,
				ReadyReplicas: &ready,
				Meta:          meta,
			}, ann), nil
		}
	}
	return withVersionFields(&CmcStatus{
		State:         "running",
		RetentionDays: retention,
		ReadyReplicas: &ready,
	}, ann), nil
}

func HistoryFromCollector(ctx context.Context, k8sCfg *rest.Config, kind, id, namespace string) ([]MetricPoint, bool, error) {
	st, err := GetCollectorStatus(ctx, k8sCfg)
	if err != nil || st.State != "running" {
		return nil, false, err
	}
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, false, err
	}
	var path string
	switch kind {
	case "cluster":
		path = "/v1/history/cluster"
	case "node":
		if id == "" {
			return nil, false, fmt.Errorf("node name required")
		}
		path = "/v1/history/nodes/" + id
	case "pod":
		if id == "" || namespace == "" {
			return nil, false, fmt.Errorf("pod name and namespace required")
		}
		path = "/v1/history/pods/" + namespace + "/" + id
	default:
		return nil, false, fmt.Errorf("unknown kind")
	}
	raw, err := proxyCollector(ctx, client, path)
	if err != nil {
		return nil, false, err
	}
	var body struct {
		Points []MetricPoint `json:"points"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, false, err
	}
	if body.Points == nil {
		body.Points = []MetricPoint{}
	}
	return body.Points, true, nil
}

func applyNS(ctx context.Context, client *kubernetes.Clientset, ns *corev1.Namespace) error {
	return createIgnoreExists(func() error {
		_, err := client.CoreV1().Namespaces().Create(ctx, ns, metav1.CreateOptions{})
		return err
	})
}

func applySA(ctx context.Context, client *kubernetes.Clientset, sa *corev1.ServiceAccount) error {
	return applyCreateOrUpdate(
		func() error {
			_, err := client.CoreV1().ServiceAccounts(sa.Namespace).Create(ctx, sa, metav1.CreateOptions{})
			return err
		},
		func() error {
			cur, gerr := client.CoreV1().ServiceAccounts(sa.Namespace).Get(ctx, sa.Name, metav1.GetOptions{})
			if gerr != nil {
				return gerr
			}
			sa.ResourceVersion = cur.ResourceVersion
			_, err := client.CoreV1().ServiceAccounts(sa.Namespace).Update(ctx, sa, metav1.UpdateOptions{})
			return err
		},
	)
}

func applyClusterRole(ctx context.Context, client *kubernetes.Clientset, cr *rbacv1.ClusterRole) error {
	return applyCreateOrUpdate(
		func() error {
			_, err := client.RbacV1().ClusterRoles().Create(ctx, cr, metav1.CreateOptions{})
			return err
		},
		func() error {
			cur, gerr := client.RbacV1().ClusterRoles().Get(ctx, cr.Name, metav1.GetOptions{})
			if gerr != nil {
				return gerr
			}
			cr.ResourceVersion = cur.ResourceVersion
			_, err := client.RbacV1().ClusterRoles().Update(ctx, cr, metav1.UpdateOptions{})
			return err
		},
	)
}

func applyClusterRoleBinding(ctx context.Context, client *kubernetes.Clientset, crb *rbacv1.ClusterRoleBinding) error {
	return applyCreateOrUpdate(
		func() error {
			_, err := client.RbacV1().ClusterRoleBindings().Create(ctx, crb, metav1.CreateOptions{})
			return err
		},
		func() error {
			cur, gerr := client.RbacV1().ClusterRoleBindings().Get(ctx, crb.Name, metav1.GetOptions{})
			if gerr != nil {
				return gerr
			}
			crb.ResourceVersion = cur.ResourceVersion
			_, err := client.RbacV1().ClusterRoleBindings().Update(ctx, crb, metav1.UpdateOptions{})
			return err
		},
	)
}

func applyConfigMap(ctx context.Context, client *kubernetes.Clientset, cm *corev1.ConfigMap) error {
	return applyCreateOrUpdate(
		func() error {
			_, err := client.CoreV1().ConfigMaps(cm.Namespace).Create(ctx, cm, metav1.CreateOptions{})
			return err
		},
		func() error {
			cur, gerr := client.CoreV1().ConfigMaps(cm.Namespace).Get(ctx, cm.Name, metav1.GetOptions{})
			if gerr != nil {
				return gerr
			}
			cm.ResourceVersion = cur.ResourceVersion
			_, err := client.CoreV1().ConfigMaps(cm.Namespace).Update(ctx, cm, metav1.UpdateOptions{})
			return err
		},
	)
}

func applyService(ctx context.Context, client *kubernetes.Clientset, svc *corev1.Service) error {
	return applyCreateOrUpdate(
		func() error {
			_, err := client.CoreV1().Services(svc.Namespace).Create(ctx, svc, metav1.CreateOptions{})
			return err
		},
		func() error {
			cur, gerr := client.CoreV1().Services(svc.Namespace).Get(ctx, svc.Name, metav1.GetOptions{})
			if gerr != nil {
				return gerr
			}
			svc.ResourceVersion = cur.ResourceVersion
			svc.Spec.ClusterIP = cur.Spec.ClusterIP
			svc.Spec.ClusterIPs = cur.Spec.ClusterIPs
			_, err := client.CoreV1().Services(svc.Namespace).Update(ctx, svc, metav1.UpdateOptions{})
			return err
		},
	)
}

func applyDeployment(ctx context.Context, client *kubernetes.Clientset, dep *appsv1.Deployment) error {
	return applyCreateOrUpdate(
		func() error {
			_, err := client.AppsV1().Deployments(dep.Namespace).Create(ctx, dep, metav1.CreateOptions{})
			return err
		},
		func() error {
			cur, gerr := client.AppsV1().Deployments(dep.Namespace).Get(ctx, dep.Name, metav1.GetOptions{})
			if gerr != nil {
				return gerr
			}
			dep.ResourceVersion = cur.ResourceVersion
			_, err := client.AppsV1().Deployments(dep.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
			return err
		},
	)
}

func ensurePVC(ctx context.Context, client *kubernetes.Clientset, pvc *corev1.PersistentVolumeClaim, storageClass string) error {
	cur, err := client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Get(ctx, pvc.Name, metav1.GetOptions{})
	if err == nil {
		phase := cur.Status.Phase
		curSc := ""
		if cur.Spec.StorageClassName != nil {
			curSc = *cur.Spec.StorageClassName
		}
		scOK := curSc == storageClass || (curSc == "" && phase == corev1.ClaimBound)
		if phase == corev1.ClaimBound && scOK {
			return nil
		}
		_ = client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{})
		time.Sleep(400 * time.Millisecond)
	} else if !errors.IsNotFound(err) {
		return err
	}
	_, err = client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Create(ctx, pvc, metav1.CreateOptions{})
	return err
}

func buildCollectorObjects(retentionDays int, storageClass string) (
	*corev1.Namespace,
	*corev1.ServiceAccount,
	*rbacv1.ClusterRole,
	*rbacv1.ClusterRoleBinding,
	*corev1.ConfigMap,
	*corev1.PersistentVolumeClaim,
	*appsv1.Deployment,
	*corev1.Service,
) {
	labels := cmcLabels()
	usePVC := storageClass != ""
	storageAnn := "emptyDir"
	if usePVC {
		storageAnn = "pvc:" + storageClass
	}

	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: CMCNamespace, Labels: labels},
	}
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: CMCName, Namespace: CMCNamespace, Labels: labels},
	}
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: CMCName + "-reader", Labels: labels},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{"metrics.k8s.io"},
			Resources: []string{"nodes", "pods"},
			Verbs:     []string{"get", "list"},
		}},
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: CMCName + "-reader", Labels: labels},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     CMCName + "-reader",
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      CMCName,
			Namespace: CMCNamespace,
		}},
	}
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: CMCName, Namespace: CMCNamespace, Labels: labels},
		Data:       map[string]string{"collector.py": BuildCollectorScript(retentionDays)},
	}

	var pvc *corev1.PersistentVolumeClaim
	if usePVC {
		sc := storageClass
		pvc = &corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: CMCName + "-data", Namespace: CMCNamespace, Labels: labels},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				StorageClassName: &sc,
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceStorage: resource.MustParse("2Gi"),
					},
				},
			},
		}
	}

	replicas := int32(1)
	mode := int32(365)
	dataVol := corev1.Volume{Name: "data", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}
	if usePVC {
		dataVol = corev1.Volume{
			Name: "data",
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: CMCName + "-data"},
			},
		}
	}

	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      CMCName,
			Namespace: CMCNamespace,
			Labels:    labels,
			Annotations: map[string]string{
				CMCAnnRetentionDays:   strconv.Itoa(retentionDays),
				CMCAnnStorage:         storageAnn,
				CMCManifestVersionAnn: strconv.Itoa(CMCManifestVersion),
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			// RWO PVC cannot Multi-Attach during rolling update — recreate old pod first.
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": CMCAppLabel}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": CMCAppLabel}},
				Spec: corev1.PodSpec{
					ServiceAccountName: CMCName,
					Containers: []corev1.Container{{
						Name:            "collector",
						Image:           "python:3.12-alpine",
						ImagePullPolicy: corev1.PullIfNotPresent,
						Command:         []string{"python", "/app/collector.py"},
						Env: []corev1.EnvVar{
							{Name: "DATA_DIR", Value: "/data"},
							{Name: "RETENTION_DAYS", Value: strconv.Itoa(retentionDays)},
							{Name: "NODE_INTERVAL_SEC", Value: "60"},
							{Name: "POD_INTERVAL_SEC", Value: "120"},
							{Name: "HTTP_PORT", Value: strconv.Itoa(CMCPort)},
						},
						Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: CMCPort}},
						VolumeMounts: []corev1.VolumeMount{
							{Name: "script", MountPath: "/app", ReadOnly: true},
							{Name: "data", MountPath: "/data"},
						},
						ReadinessProbe: &corev1.Probe{
							ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/health", Port: intstr.FromString("http")}},
							InitialDelaySeconds: 5,
							PeriodSeconds:       10,
						},
						LivenessProbe: &corev1.Probe{
							ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/health", Port: intstr.FromString("http")}},
							InitialDelaySeconds: 15,
							PeriodSeconds:       20,
						},
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("20m"),
								corev1.ResourceMemory: resource.MustParse("64Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("200m"),
								corev1.ResourceMemory: resource.MustParse("256Mi"),
							},
						},
					}},
					Volumes: []corev1.Volume{
						{
							Name: "script",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{Name: CMCName},
									DefaultMode:          &mode,
								},
							},
						},
						dataVol,
					},
				},
			},
		},
	}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: CMCName, Namespace: CMCNamespace, Labels: labels},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{"app": CMCAppLabel},
			Ports: []corev1.ServicePort{{
				Name:       "http",
				Port:       CMCPort,
				TargetPort: intstr.FromInt(CMCPort),
			}},
		},
	}
	return ns, sa, cr, crb, cm, pvc, dep, svc
}

func EnableCollector(ctx context.Context, k8sCfg *rest.Config, retentionDays int) (*CmcStatus, error) {
	retentionDays = NormalizeRetention(retentionDays)
	if err := EnsureMetricsServer(ctx, k8sCfg); err != nil {
		return nil, fmt.Errorf("ensure metrics-server: %w", err)
	}
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	sc, _ := resolveStorageClassName(ctx, client)
	ns, sa, cr, crb, cm, pvc, dep, svc := buildCollectorObjects(retentionDays, sc)

	if err := applyNS(ctx, client, ns); err != nil {
		return nil, err
	}
	if err := applySA(ctx, client, sa); err != nil {
		return nil, err
	}
	if err := applyClusterRole(ctx, client, cr); err != nil {
		return nil, err
	}
	if err := applyClusterRoleBinding(ctx, client, crb); err != nil {
		return nil, err
	}
	if err := applyConfigMap(ctx, client, cm); err != nil {
		return nil, err
	}
	if pvc != nil && sc != "" {
		if err := ensurePVC(ctx, client, pvc, sc); err != nil {
			return nil, err
		}
	} else {
		_ = client.CoreV1().PersistentVolumeClaims(CMCNamespace).Delete(ctx, CMCName+"-data", metav1.DeleteOptions{})
	}
	if err := applyDeployment(ctx, client, dep); err != nil {
		return nil, err
	}
	if err := applyService(ctx, client, svc); err != nil {
		return nil, err
	}

	// Bounce pods so ConfigMap/env refresh
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{%q:%q}}}}}`, CMCAnnRestartedAt, time.Now().UTC().Format(time.RFC3339))
	_, _ = client.AppsV1().Deployments(CMCNamespace).Patch(
		ctx, CMCName, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{},
	)

	return GetCollectorStatus(ctx, k8sCfg)
}

func DisableCollector(ctx context.Context, k8sCfg *rest.Config) (*CmcStatus, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}
	del := metav1.DeleteOptions{}
	_ = client.AppsV1().Deployments(CMCNamespace).Delete(ctx, CMCName, del)
	_ = client.CoreV1().Services(CMCNamespace).Delete(ctx, CMCName, del)
	_ = client.CoreV1().ConfigMaps(CMCNamespace).Delete(ctx, CMCName, del)
	_ = client.CoreV1().PersistentVolumeClaims(CMCNamespace).Delete(ctx, CMCName+"-data", del)
	_ = client.CoreV1().ServiceAccounts(CMCNamespace).Delete(ctx, CMCName, del)
	_ = client.RbacV1().ClusterRoleBindings().Delete(ctx, CMCName+"-reader", del)
	_ = client.RbacV1().ClusterRoles().Delete(ctx, CMCName+"-reader", del)
	_ = client.CoreV1().Namespaces().Delete(ctx, CMCNamespace, del)
	st, err := GetCollectorStatus(ctx, k8sCfg)
	if err != nil {
		return nil, err
	}
	if st.State == "missing" {
		st.Message = "Collector removed"
		return st, nil
	}
	st.State = "pending"
	if st.Message == "" {
		st.Message = "Removing…"
	}
	return st, nil
}
