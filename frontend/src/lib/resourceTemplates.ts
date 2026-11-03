import { CLUSTER_SCOPED_KINDS } from './resourceKinds'

export const NON_CREATABLE_KINDS = new Set([
  'events',
  'endpoints',
  'endpointslices',
  'replicasets',
  'replicationcontrollers',
  'csinodes',
  'volumeattachments',
])

const KIND_META: Record<string, { apiVersion: string; kind: string }> = {
  namespaces: { apiVersion: 'v1', kind: 'Namespace' },
  pods: { apiVersion: 'v1', kind: 'Pod' },
  services: { apiVersion: 'v1', kind: 'Service' },
  configmaps: { apiVersion: 'v1', kind: 'ConfigMap' },
  secrets: { apiVersion: 'v1', kind: 'Secret' },
  persistentvolumeclaims: { apiVersion: 'v1', kind: 'PersistentVolumeClaim' },
  persistentvolumes: { apiVersion: 'v1', kind: 'PersistentVolume' },
  serviceaccounts: { apiVersion: 'v1', kind: 'ServiceAccount' },
  resourcequotas: { apiVersion: 'v1', kind: 'ResourceQuota' },
  limitranges: { apiVersion: 'v1', kind: 'LimitRange' },
  deployments: { apiVersion: 'apps/v1', kind: 'Deployment' },
  daemonsets: { apiVersion: 'apps/v1', kind: 'DaemonSet' },
  statefulsets: { apiVersion: 'apps/v1', kind: 'StatefulSet' },
  jobs: { apiVersion: 'batch/v1', kind: 'Job' },
  cronjobs: { apiVersion: 'batch/v1', kind: 'CronJob' },
  ingresses: { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress' },
  ingressclasses: { apiVersion: 'networking.k8s.io/v1', kind: 'IngressClass' },
  networkpolicies: { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy' },
  storageclasses: { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass' },
  horizontalpodautoscalers: { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler' },
  poddisruptionbudgets: { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget' },
  priorityclasses: { apiVersion: 'scheduling.k8s.io/v1', kind: 'PriorityClass' },
  runtimeclasses: { apiVersion: 'node.k8s.io/v1', kind: 'RuntimeClass' },
  leases: { apiVersion: 'coordination.k8s.io/v1', kind: 'Lease' },
  roles: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role' },
  clusterroles: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole' },
  rolebindings: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding' },
  clusterrolebindings: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding' },
  certificatesigningrequests: { apiVersion: 'certificates.k8s.io/v1', kind: 'CertificateSigningRequest' },
  csidrivers: { apiVersion: 'storage.k8s.io/v1', kind: 'CSIDriver' },
  csistoragecapacities: { apiVersion: 'storage.k8s.io/v1', kind: 'CSIStorageCapacity' },
  mutatingwebhookconfigurations: { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'MutatingWebhookConfiguration' },
  validatingwebhookconfigurations: { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'ValidatingWebhookConfiguration' },
  flowschemas: { apiVersion: 'flowcontrol.apiserver.k8s.io/v1', kind: 'FlowSchema' },
  prioritylevelconfigurations: { apiVersion: 'flowcontrol.apiserver.k8s.io/v1', kind: 'PriorityLevelConfiguration' },
  validatingadmissionpolicies: { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'ValidatingAdmissionPolicy' },
  validatingadmissionpolicybindings: { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'ValidatingAdmissionPolicyBinding' },
}

const SPEC_TEMPLATES: Partial<Record<string, string>> = {
  pods: `spec:
  containers:
  - name: main
    image: nginx:alpine
`,
  deployments: `spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: main
        image: nginx:alpine
`,
  services: `spec:
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 80
`,
  configmaps: `data:
  key: value
`,
  secrets: `type: Opaque
stringData:
  key: value
`,
  persistentvolumeclaims: `spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`,
  jobs: `spec:
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: main
        image: busybox:1.36
        command: ["sh", "-c", "echo hello"]
`,
  cronjobs: `spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: main
            image: busybox:1.36
            command: ["sh", "-c", "echo hello"]
`,
  ingresses: `spec:
  rules:
  - host: example.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-service
            port:
              number: 80
`,
  namespaces: '',
}

export function getResourceTemplate(kind: string, namespace = 'default'): string {
  const meta = KIND_META[kind] ?? { apiVersion: 'v1', kind: kind.replace(/s$/, '') }
  const nsLine = CLUSTER_SCOPED_KINDS.has(kind) ? '' : `  namespace: ${namespace}\n`
  const spec = SPEC_TEMPLATES[kind]
  if (spec !== undefined) {
    return `apiVersion: ${meta.apiVersion}
kind: ${meta.kind}
metadata:
  name: my-${kind.replace(/s$/, '')}
${nsLine}${spec}`.trimEnd() + '\n'
  }
  return `apiVersion: ${meta.apiVersion}
kind: ${meta.kind}
metadata:
  name: my-resource
${nsLine}`.trimEnd() + '\n'
}
