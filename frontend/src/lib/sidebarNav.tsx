import type { ReactNode } from 'react'
import {
  Activity, AppWindow, Bell, Binary, Box, Boxes, Clock, Crown, Cpu, Database, FileKey, FileText,
  Gauge, Globe, HardDrive, Key, LayoutDashboard, LayoutGrid,
  Layers, Link, ListOrdered, Lock, Network, Package, Paperclip, Play, Plug,
  Server, Share2, Shield, ShieldCheck, Sliders, Tag, Timer, TrendingUp, Umbrella,
  UserCheck, UserCircle, Users, Webhook,
} from 'lucide-react'
import type { Resource } from './resourceKinds'

export interface SidebarNavItem {
  id: Resource
  label: string
  icon: ReactNode
}

export interface SidebarNavCategory {
  id: string
  label: string
  /** Category row icon in the sidebar tree. */
  icon: ReactNode
  items: SidebarNavItem[]
}

export const SIDEBAR_TOP_ITEMS: SidebarNavItem[] = [
  { id: 'overview',     label: 'Overview',      icon: <LayoutDashboard size={13} /> },
  { id: 'applications', label: 'Applications',  icon: <AppWindow size={13} /> },
  { id: 'namespaces',   label: 'Namespaces',    icon: <Boxes size={13} /> },
  { id: 'nodes',        label: 'Nodes',         icon: <Cpu size={13} /> },
]

export const SIDEBAR_CATEGORIES: SidebarNavCategory[] = [
  {
    id: 'workloads',
    label: 'Workloads',
    icon: <LayoutGrid size={11} />,
    items: [
      { id: 'pods',                   label: 'Pods',                   icon: <Box size={12} /> },
      { id: 'deployments',            label: 'Deployments',            icon: <Layers size={12} /> },
      { id: 'replicasets',            label: 'Replica Sets',           icon: <LayoutGrid size={12} /> },
      { id: 'replicationcontrollers', label: 'Replication Controllers', icon: <Activity size={12} /> },
      { id: 'daemonsets',             label: 'Daemon Sets',            icon: <Activity size={12} /> },
      { id: 'statefulsets',           label: 'Stateful Sets',          icon: <Database size={12} /> },
      { id: 'jobs',                   label: 'Jobs',                   icon: <Play size={12} /> },
      { id: 'cronjobs',               label: 'Cron Jobs',              icon: <Clock size={12} /> },
      { id: 'events',                 label: 'Events',                 icon: <Bell size={12} /> },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    icon: <Globe size={11} />,
    items: [
      { id: 'services',         label: 'Services',              icon: <Network size={12} /> },
      { id: 'ingresses',        label: 'Ingresses',             icon: <Globe size={12} /> },
      { id: 'ingressclasses',   label: 'Ingress Classes',       icon: <Tag size={12} /> },
      { id: 'endpointslices',   label: 'Endpoint Slices',       icon: <Activity size={12} /> },
      { id: 'endpoints',        label: 'Endpoints',             icon: <Link size={12} /> },
      { id: 'networkpolicies',  label: 'Network Policies',      icon: <Shield size={12} /> },
      { id: 'network-map',      label: 'Policy Map',             icon: <Share2 size={12} /> },
      { id: 'portforwards',     label: 'Port Forwarding',       icon: <Plug size={12} /> },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: <HardDrive size={11} />,
    items: [
      { id: 'persistentvolumeclaims', label: 'Persistent Volume Claims', icon: <HardDrive size={12} /> },
      { id: 'persistentvolumes',      label: 'Persistent Volumes',      icon: <HardDrive size={12} /> },
      { id: 'storageclasses',         label: 'Storage Classes',         icon: <Database size={12} /> },
      { id: 'volumeattachments',      label: 'Volume Attachments',      icon: <Paperclip size={12} /> },
      { id: 'csidrivers',             label: 'CSI Drivers',             icon: <Cpu size={12} /> },
      { id: 'csinodes',               label: 'CSI Nodes',               icon: <Server size={12} /> },
      { id: 'csistoragecapacities',   label: 'CSI Storage Capacities',  icon: <Database size={12} /> },
    ],
  },
  {
    id: 'config',
    label: 'Config',
    icon: <FileText size={11} />,
    items: [
      { id: 'configmaps',                    label: 'Config Maps',          icon: <FileText size={12} /> },
      { id: 'secrets',                       label: 'Secrets',              icon: <Lock size={12} /> },
      { id: 'resourcequotas',               label: 'Resource Quotas',       icon: <Gauge size={12} /> },
      { id: 'limitranges',                  label: 'Limit Ranges',          icon: <Sliders size={12} /> },
      { id: 'horizontalpodautoscalers',     label: 'Horizontal Pod Autoscalers', icon: <TrendingUp size={12} /> },
      { id: 'poddisruptionbudgets',         label: 'Pod Disruption Budgets',     icon: <Umbrella size={12} /> },
      { id: 'priorityclasses',              label: 'Priority Classes',      icon: <ListOrdered size={12} /> },
      { id: 'runtimeclasses',              label: 'Runtime Classes',        icon: <Binary size={12} /> },
      { id: 'leases',                       label: 'Leases',                icon: <Timer size={12} /> },
      { id: 'mutatingwebhookconfigurations',      label: 'Mutating Webhook Configurations',        icon: <Webhook size={12} /> },
      { id: 'validatingwebhookconfigurations',    label: 'Validating Webhook Configurations',      icon: <ShieldCheck size={12} /> },
      { id: 'validatingadmissionpolicies',        label: 'Validating Admission Policies',          icon: <Shield size={12} /> },
      { id: 'validatingadmissionpolicybindings',  label: 'Validating Admission Policy Bindings',   icon: <Shield size={12} /> },
      { id: 'flowschemas',                        label: 'Flow Schemas',                           icon: <Network size={12} /> },
      { id: 'prioritylevelconfigurations',        label: 'Priority Level Configurations',          icon: <Gauge size={12} /> },
    ],
  },
  {
    id: 'access-control',
    label: 'Access Control',
    icon: <Shield size={11} />,
    items: [
      { id: 'serviceaccounts',            label: 'Service Accounts',             icon: <UserCircle size={12} /> },
      { id: 'clusterroles',               label: 'Cluster Roles',                icon: <Crown size={12} /> },
      { id: 'roles',                      label: 'Roles',                        icon: <Key size={12} /> },
      { id: 'clusterrolebindings',        label: 'Cluster Role Bindings',        icon: <Users size={12} /> },
      { id: 'rolebindings',               label: 'Role Bindings',                icon: <UserCheck size={12} /> },
      { id: 'certificatesigningrequests', label: 'Certificate Signing Requests', icon: <FileKey size={12} /> },
    ],
  },
  {
    id: 'helm',
    label: 'Helm',
    icon: <Package size={11} />,
    items: [
      { id: 'helm-releases', label: 'Releases', icon: <Package size={12} /> },
      { id: 'helm-charts',   label: 'Charts',   icon: <LayoutGrid size={12} /> },
    ],
  },
]
