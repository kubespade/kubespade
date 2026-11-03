import type { PodContainerList } from '../hooks/usePodContainers'

export type ContainerTabItem = {
  name: string
  init: boolean
  runnable: boolean
}

/** Init containers first, then app containers; runnable = currently running. */
export function buildContainerTabs(list: PodContainerList | null): ContainerTabItem[] {
  if (!list) return []
  const running = list.running ?? []
  return [
    ...list.init.map(n => ({
      name: n,
      init: true,
      runnable: running.includes(n),
    })),
    ...list.containers.map(n => ({
      name: n,
      init: false,
      runnable: running.includes(n),
    })),
  ]
}

const VARIANTS = {
  exec: {
    list: 'exec-tabs',
    tab: 'exec-tab',
    active: 'exec-tab-active',
    disabled: 'exec-tab-disabled',
    init: 'exec-tab-init',
  },
  files: {
    list: 'pod-files-containers',
    tab: 'pod-files-container',
    active: 'pod-files-container-active',
    disabled: 'pod-files-container-disabled',
    init: 'pod-files-container-init',
  },
} as const

export type ContainerTabsVariant = keyof typeof VARIANTS

type Props = {
  tabs: ContainerTabItem[]
  active: string
  onSelect: (name: string) => void
  variant: ContainerTabsVariant
  /** Extra disable (e.g. transfer in progress). */
  disabled?: boolean
  /** Hide when only one container (default true). */
  hideIfSingle?: boolean
}

export function ContainerTabs({
  tabs,
  active,
  onSelect,
  variant,
  disabled = false,
  hideIfSingle = true,
}: Props) {
  if (hideIfSingle && tabs.length <= 1) return null
  const v = VARIANTS[variant]
  return (
    <div className={v.list}>
      {tabs.map(t => (
        <button
          key={t.name}
          type="button"
          disabled={!t.runnable || disabled}
          className={`${v.tab}${active === t.name ? ` ${v.active}` : ''}${!t.runnable ? ` ${v.disabled}` : ''}`}
          title={t.runnable ? undefined : 'Container not running'}
          onClick={() => {
            if (!t.runnable || disabled) return
            onSelect(t.name)
          }}
        >
          {t.init && <span className={v.init}>init</span>}
          {t.name}
        </button>
      ))}
    </div>
  )
}
