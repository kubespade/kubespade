import {
  Box, Cloud, FileText, FolderTree, Layers, Package, Terminal, Zap,
} from 'lucide-react'

interface Props {
  profileCount: number
  connectedCount: number
  onAdd: () => void
}

const FEATURES = [
  {
    icon: <FileText size={18} />,
    title: 'kubeconfig',
    desc: 'Import from ~/.kube/config (live-linked) or upload YAML. Supports exec plugins like aws-vault.',
  },
  {
    icon: <Cloud size={18} />,
    title: 'Multi-cloud',
    desc: 'AWS EKS, GCP GKE, and Azure AKS — connect with credentials or kubeconfig.',
  },
  {
    icon: <Layers size={18} />,
    title: 'Full resource browser',
    desc: 'Pods, Deployments, Services, Ingresses, CRDs, Helm releases, and more.',
  },
  {
    icon: <Terminal size={18} />,
    title: 'Exec & logs',
    desc: 'Shell into pods and nodes, stream logs, port-forward services with one click.',
  },
  {
    icon: <FolderTree size={18} />,
    title: 'Cluster groups',
    desc: 'Organise clusters into groups in the sidebar for dev, staging, and production.',
  },
  {
    icon: <Zap size={18} />,
    title: 'Live updates',
    desc: 'Real-time resource lists with metrics, events, and cluster overview dashboards.',
  },
]

export function HomePage({ profileCount, connectedCount, onAdd }: Props) {
  return (
    <div className="home-page">
      <div className="home-header">
        <h2>Welcome</h2>
        <button type="button" className="page-header-btn" onClick={onAdd}>+ Add</button>
      </div>

      <div className="home-body">
        <div className="home-col">
          <section className="home-hero">
            <div className="home-hero-brand">
              <div className="home-hero-icon" aria-hidden />
              <h1>KubeSpade</h1>
            </div>
            <p className="home-tagline">
              A fast, native Kubernetes client for your desktop.
              Browse clusters, manage workloads, and debug — without leaving the app.
            </p>
            {profileCount > 0 && (
              <div className="home-stats">
                <span><Box size={13} /> {profileCount} cluster{profileCount !== 1 ? 's' : ''} saved</span>
                {connectedCount > 0 && (
                  <span className="home-stats-live">
                    <span className="live-dot" /> {connectedCount} connected
                  </span>
                )}
              </div>
            )}
          </section>

          <section className="home-features">
            <h3>Features</h3>
            <div className="home-feature-grid">
              {FEATURES.map(f => (
                <div key={f.title} className="home-feature-card">
                  <div className="home-feature-icon">{f.icon}</div>
                  <div>
                    <div className="home-feature-title">{f.title}</div>
                    <div className="home-feature-desc">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="home-getting-started">
            <h3>Getting started</h3>
            <ol className="home-steps">
              <li>Click <strong>+ Add</strong> to import a kubeconfig or cloud credentials.</li>
              <li>Click a cluster in the sidebar to connect and start browsing.</li>
              <li>Browse resources, exec into pods, forward ports, and explore Helm releases.</li>
            </ol>
            {profileCount === 0 && (
              <button type="button" className="home-cta" onClick={onAdd}>
                <Package size={15} /> Add your first cluster
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
