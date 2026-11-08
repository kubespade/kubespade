package services

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func listPods(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, p := range list.Items {
		total := len(p.Spec.Containers)
		ready := 0
		restarts := int32(0)
		for _, cs := range p.Status.ContainerStatuses {
			if cs.Ready {
				ready++
			}
			restarts += cs.RestartCount
		}

		// Build containers field: "!initName:color:restarts,name:color:restarts,..."
		// '!' prefix = init container; color: g=green, y=yellow, r=red, s=gray(completed)
		initStatusMap := make(map[string]corev1.ContainerStatus, len(p.Status.InitContainerStatuses))
		for _, cs := range p.Status.InitContainerStatuses {
			initStatusMap[cs.Name] = cs
		}
		csMap := make(map[string]corev1.ContainerStatus, len(p.Status.ContainerStatuses))
		for _, cs := range p.Status.ContainerStatuses {
			csMap[cs.Name] = cs
		}

		dots := make([]string, 0, len(p.Spec.InitContainers)+total)
		for _, ic := range p.Spec.InitContainers {
			cs, ok := initStatusMap[ic.Name]
			color := "y"
			r := int32(0)
			if ok {
				color = containerDotColor(cs)
				r = cs.RestartCount
			}
			dots = append(dots, fmt.Sprintf("!%s:%s:%d", ic.Name, color, r))
		}
		for _, c := range p.Spec.Containers {
			cs, ok := csMap[c.Name]
			color := "y"
			r := int32(0)
			if ok {
				color = containerDotColor(cs)
				r = cs.RestartCount
			}
			dots = append(dots, fmt.Sprintf("%s:%s:%d", c.Name, color, r))
		}

		podPorts := []string{}
		for _, c := range p.Spec.Containers {
			for _, pp := range c.Ports {
				if pp.ContainerPort > 0 {
					podPorts = append(podPorts, fmt.Sprintf("%d", pp.ContainerPort))
				}
			}
		}

		cpuReq, cpuLim, memReq, memLim := podResourceTotals(p)
		fields := map[string]string{
			"status":     computePodStatus(p),
			"ready":      fmt.Sprintf("%d/%d", ready, total),
			"restarts":   fmt.Sprintf("%d", restarts),
			"node":       p.Spec.NodeName,
			"containers": strings.Join(dots, ","),
			"ip":         p.Status.PodIP,
			"ports":      strings.Join(podPorts, ","),
		}
		if restarts > 0 {
			if reason := lastRestartReason(p); reason != "" {
				fields["restartReason"] = reason
			}
		}
		if cpuReq > 0 {
			fields["cpuReqMilli"] = fmt.Sprintf("%d", cpuReq)
		}
		if cpuLim > 0 {
			fields["cpuLimMilli"] = fmt.Sprintf("%d", cpuLim)
		}
		if memReq > 0 {
			fields["memReqBytes"] = fmt.Sprintf("%d", memReq)
		}
		if memLim > 0 {
			fields["memLimBytes"] = fmt.Sprintf("%d", memLim)
		}

		items = append(items, ResourceRow{
			Name:      p.Name,
			Namespace: p.Namespace,
			Age:       p.CreationTimestamp.Unix(),
			Fields:    fields,
		})
	}
	return &ResourceList{Kind: "pods", Items: items}, nil
}

func listServices(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, svc := range list.Items {
		externalIP := "<none>"
		switch svc.Spec.Type {
		case corev1.ServiceTypeLoadBalancer:
			ips := []string{}
			for _, ing := range svc.Status.LoadBalancer.Ingress {
				if ing.IP != "" {
					ips = append(ips, ing.IP)
				} else if ing.Hostname != "" {
					ips = append(ips, ing.Hostname)
				}
			}
			if len(ips) > 0 {
				externalIP = strings.Join(ips, ",")
			} else {
				externalIP = "<pending>"
			}
		}
		ports := []string{}
		for _, p := range svc.Spec.Ports {
			if p.NodePort != 0 {
				ports = append(ports, fmt.Sprintf("%d:%d/%s", p.Port, p.NodePort, p.Protocol))
			} else {
				ports = append(ports, fmt.Sprintf("%d/%s", p.Port, p.Protocol))
			}
		}
		portsStr := strings.Join(ports, ", ")
		if portsStr == "" {
			portsStr = "<none>"
		}
		items = append(items, ResourceRow{
			Name:      svc.Name,
			Namespace: svc.Namespace,
			Age:       svc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"type":       string(svc.Spec.Type),
				"clusterIP":  svc.Spec.ClusterIP,
				"externalIP": externalIP,
				"ports":      portsStr,
			},
		})
	}
	return &ResourceList{Kind: "services", Items: items}, nil
}

func listPVCs(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, pvc := range list.Items {
		capacity := ""
		if q, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
			gb := float64(q.Value()) / (1 << 30)
			if gb >= 1 {
				capacity = fmt.Sprintf("%.0fGi", gb)
			} else {
				capacity = fmt.Sprintf("%.0fMi", float64(q.Value())/(1<<20))
			}
		}
		accessMode := ""
		if len(pvc.Spec.AccessModes) > 0 {
			accessMode = string(pvc.Spec.AccessModes[0])
		}
		sc := ""
		if pvc.Spec.StorageClassName != nil {
			sc = *pvc.Spec.StorageClassName
		}
		items = append(items, ResourceRow{
			Name:      pvc.Name,
			Namespace: pvc.Namespace,
			Age:       pvc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"status":       string(pvc.Status.Phase),
				"capacity":     capacity,
				"accessMode":   accessMode,
				"storageClass": sc,
				"volume":       pvc.Spec.VolumeName,
			},
		})
	}
	return &ResourceList{Kind: "persistentvolumeclaims", Items: items}, nil
}

func listConfigMaps(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, cm := range list.Items {
		items = append(items, ResourceRow{
			Name:      cm.Name,
			Namespace: cm.Namespace,
			Age:       cm.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"data": fmt.Sprintf("%d", len(cm.Data)),
			},
		})
	}
	return &ResourceList{Kind: "configmaps", Items: items}, nil
}

func listReplicationControllers(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().ReplicationControllers(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, rc := range list.Items {
		desired := int32(1)
		if rc.Spec.Replicas != nil {
			desired = *rc.Spec.Replicas
		}
		items = append(items, ResourceRow{
			Name:      rc.Name,
			Namespace: rc.Namespace,
			Age:       rc.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"desired":   fmt.Sprintf("%d", desired),
				"ready":     fmt.Sprintf("%d", rc.Status.ReadyReplicas),
				"available": fmt.Sprintf("%d", rc.Status.AvailableReplicas),
			},
		})
	}
	return &ResourceList{Kind: "replicationcontrollers", Items: items}, nil
}

func listPersistentVolumes(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, pv := range list.Items {
		capacity := ""
		if q, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
			gb := float64(q.Value()) / (1 << 30)
			if gb >= 1 {
				capacity = fmt.Sprintf("%.0fGi", gb)
			} else {
				capacity = fmt.Sprintf("%.0fMi", float64(q.Value())/(1<<20))
			}
		}
		modes := []string{}
		for _, am := range pv.Spec.AccessModes {
			switch am {
			case corev1.ReadWriteOnce:
				modes = append(modes, "RWO")
			case corev1.ReadOnlyMany:
				modes = append(modes, "ROX")
			case corev1.ReadWriteMany:
				modes = append(modes, "RWX")
			case corev1.ReadWriteOncePod:
				modes = append(modes, "RWOP")
			default:
				modes = append(modes, string(am))
			}
		}
		claim := ""
		if pv.Spec.ClaimRef != nil {
			claim = fmt.Sprintf("%s/%s", pv.Spec.ClaimRef.Namespace, pv.Spec.ClaimRef.Name)
		}
		items = append(items, ResourceRow{
			Name: pv.Name,
			Age:  pv.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"capacity":      capacity,
				"accessModes":   strings.Join(modes, ", "),
				"reclaimPolicy": string(pv.Spec.PersistentVolumeReclaimPolicy),
				"status":        string(pv.Status.Phase),
				"storageClass":  pv.Spec.StorageClassName,
				"claim":         claim,
			},
		})
	}
	return &ResourceList{Kind: "persistentvolumes", Items: items}, nil
}

func listEndpoints(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, ep := range list.Items {
		addrCount := 0
		for _, sub := range ep.Subsets {
			addrCount += len(sub.Addresses)
		}
		items = append(items, ResourceRow{
			Name:      ep.Name,
			Namespace: ep.Namespace,
			Age:       ep.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"endpoints": fmt.Sprintf("%d", addrCount),
			},
		})
	}
	return &ResourceList{Kind: "endpoints", Items: items}, nil
}

func listSecrets(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, s := range list.Items {
		items = append(items, ResourceRow{
			Name:      s.Name,
			Namespace: s.Namespace,
			Age:       s.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"type": string(s.Type),
				"data": fmt.Sprintf("%d", len(s.Data)),
			},
		})
	}
	return &ResourceList{Kind: "secrets", Items: items}, nil
}

func listResourceQuotas(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().ResourceQuotas(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, rq := range list.Items {
		items = append(items, ResourceRow{
			Name:      rq.Name,
			Namespace: rq.Namespace,
			Age:       rq.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"hard": fmt.Sprintf("%d", len(rq.Spec.Hard)),
				"used": fmt.Sprintf("%d", len(rq.Status.Used)),
			},
		})
	}
	return &ResourceList{Kind: "resourcequotas", Items: items}, nil
}

func listLimitRanges(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().LimitRanges(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, lr := range list.Items {
		items = append(items, ResourceRow{
			Name:      lr.Name,
			Namespace: lr.Namespace,
			Age:       lr.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"limits": fmt.Sprintf("%d", len(lr.Spec.Limits)),
			},
		})
	}
	return &ResourceList{Kind: "limitranges", Items: items}, nil
}

func listServiceAccounts(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.CoreV1().ServiceAccounts(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, sa := range list.Items {
		items = append(items, ResourceRow{
			Name:      sa.Name,
			Namespace: sa.Namespace,
			Age:       sa.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"secrets":         fmt.Sprintf("%d", len(sa.Secrets)),
				"imagePullSecret": fmt.Sprintf("%d", len(sa.ImagePullSecrets)),
			},
		})
	}
	return &ResourceList{Kind: "serviceaccounts", Items: items}, nil
}

func listNamespaces(ctx context.Context, client *kubernetes.Clientset, _ string) (*ResourceList, error) {
	list, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, ns := range list.Items {
		items = append(items, ResourceRow{
			Name: ns.Name,
			Age:  ns.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"status": string(ns.Status.Phase),
			},
		})
	}
	return &ResourceList{Kind: "namespaces", Items: items}, nil
}

func listEvents(ctx context.Context, client *kubernetes.Clientset, namespace string) (*ResourceList, error) {
	list, err := client.EventsV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]ResourceRow, 0, len(list.Items))
	for _, e := range list.Items {
		count := "1"
		if e.Series != nil {
			count = fmt.Sprintf("%d", e.Series.Count)
		}
		obj := fmt.Sprintf("%s/%s", e.Regarding.Kind, e.Regarding.Name)
		message := e.Note
		if len(message) > 80 {
			message = message[:77] + "..."
		}
		items = append(items, ResourceRow{
			Name:      e.Name,
			Namespace: e.Namespace,
			Age:       e.CreationTimestamp.Unix(),
			Fields: map[string]string{
				"type":    e.Type,
				"reason":  e.Reason,
				"object":  obj,
				"message": message,
				"count":   count,
			},
		})
	}
	return &ResourceList{Kind: "events", Items: items}, nil
}
