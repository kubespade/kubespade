import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, Terminal } from 'lucide-react'
import { api } from '../../api/client'
import { arr, decodeSecretValue, formatPvcMount, pvcVolumeMap, raw, rec } from '../../lib/resourceInfoProps'

export function containerStateInfo(cs: unknown): { text: string; cls: string } {
  const state = rec(rec(cs).state)
  if (state.running)    return { text: 'Running',    cls: 'ip-cstate-running' }
  if (state.waiting)    return { text: raw(rec(state.waiting).reason)    || 'Waiting',    cls: 'ip-cstate-waiting' }
  if (state.terminated) {
    const t = rec(state.terminated)
    if (Number(t.exitCode) === 0) return { text: raw(t.reason) || 'Completed', cls: 'ip-cstate-completed' }
    return { text: raw(t.reason) || 'Terminated', cls: 'ip-cstate-terminated' }
  }
  return { text: 'Unknown', cls: '' }
}

export type EnvLine = { name: string; value: string; secret?: boolean; source?: string; unresolved?: boolean }

export type EnvSourceMaps = {
  secrets: Map<string, Record<string, string> | null>
  configMaps: Map<string, Record<string, string> | null>
  loaded: boolean
}

export function visitContainerEnvRefs(c: unknown, secrets: Set<string>, configMaps: Set<string>) {
  const cont = rec(c)
  for (const e of arr(cont.envFrom)) {
    const er = rec(e)
    const s = raw(rec(er.secretRef).name)
    const cm = raw(rec(er.configMapRef).name)
    if (s) secrets.add(s)
    if (cm) configMaps.add(cm)
  }
  for (const e of arr(cont.env)) {
    const vf = rec(rec(e).valueFrom)
    const s = raw(rec(vf.secretKeyRef).name)
    const cm = raw(rec(vf.configMapKeyRef).name)
    if (s) secrets.add(s)
    if (cm) configMaps.add(cm)
  }
}

export function collectEnvRefs(spec: Record<string, unknown>): { secrets: string[]; configMaps: string[] } {
  const secrets = new Set<string>()
  const configMaps = new Set<string>()
  for (const c of arr(spec.containers)) visitContainerEnvRefs(c, secrets, configMaps)
  for (const c of arr(spec.initContainers)) visitContainerEnvRefs(c, secrets, configMaps)
  for (const c of arr(spec.ephemeralContainers)) visitContainerEnvRefs(c, secrets, configMaps)
  return { secrets: [...secrets], configMaps: [...configMaps] }
}

export function useEnvSourceMaps(profile: string, namespace: string | undefined, spec: Record<string, unknown>): EnvSourceMaps {
  const [secrets, setSecrets] = useState<Map<string, Record<string, string> | null>>(new Map())
  const [configMaps, setConfigMaps] = useState<Map<string, Record<string, string> | null>>(new Map())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const refs = collectEnvRefs(spec)
    if (!profile || !namespace || (refs.secrets.length === 0 && refs.configMaps.length === 0)) {
      setSecrets(new Map())
      setConfigMaps(new Map())
      setLoaded(true)
      return
    }
    let cancelled = false
    setLoaded(false)
    void (async () => {
      const [sPairs, cPairs] = await Promise.all([
        Promise.all(refs.secrets.map(async name => {
          try {
            const d = await api.getResourceDetail(profile, 'secrets', name, namespace)
            const decoded: Record<string, string> = {}
            for (const [k, v] of Object.entries(rec(d.data))) {
              decoded[k] = decodeSecretValue(String(v)).text
            }
            return [name, decoded] as const
          } catch {
            return [name, null] as const
          }
        })),
        Promise.all(refs.configMaps.map(async name => {
          try {
            const d = await api.getResourceDetail(profile, 'configmaps', name, namespace)
            const data: Record<string, string> = {}
            for (const [k, v] of Object.entries(rec(d.data))) data[k] = String(v)
            return [name, data] as const
          } catch {
            return [name, null] as const
          }
        })),
      ])
      if (cancelled) return
      setSecrets(new Map(sPairs))
      setConfigMaps(new Map(cPairs))
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [profile, namespace, spec])

  return { secrets, configMaps, loaded }
}

export function putEnvFrom(
  out: Map<string, EnvLine>,
  data: Record<string, string> | null | undefined,
  prefix: string,
  secret: boolean,
  srcName: string,
) {
  if (!data) {
    out.set(`__from__${srcName}`, {
      name: prefix ? `${prefix}*` : srcName,
      value: '',
      secret,
      source: srcName,
      unresolved: true,
    })
    return
  }
  for (const [k, v] of Object.entries(data)) {
    out.set(prefix + k, { name: prefix + k, value: v, secret, source: secret ? srcName : undefined })
  }
}

export function resolveContainerEnv(cont: Record<string, unknown>, sources: EnvSourceMaps): EnvLine[] {
  const out = new Map<string, EnvLine>()

  for (const e of arr(cont.envFrom)) {
    const er = rec(e)
    const prefix = raw(er.prefix)
    const secretName = raw(rec(er.secretRef).name)
    const cmName = raw(rec(er.configMapRef).name)
    if (secretName) {
      if (sources.loaded || sources.secrets.has(secretName)) {
        putEnvFrom(out, sources.secrets.get(secretName), prefix, true, secretName)
      }
    } else if (cmName) {
      if (sources.loaded || sources.configMaps.has(cmName)) {
        putEnvFrom(out, sources.configMaps.get(cmName), prefix, false, cmName)
      }
    }
  }

  for (const e of arr(cont.env)) {
    const er = rec(e)
    const name = raw(er.name)
    if (!name) continue
    const vf = rec(er.valueFrom)
    const skr = rec(vf.secretKeyRef)
    const cmr = rec(vf.configMapKeyRef)
    const field = rec(vf.fieldRef)
    const res = rec(vf.resourceFieldRef)
    if (raw(skr.name)) {
      const data = sources.secrets.get(raw(skr.name))
      const key = raw(skr.key)
      const val = data?.[key]
      out.set(name, {
        name,
        value: val ?? '',
        secret: true,
        source: raw(skr.name),
        unresolved: data == null || val === undefined,
      })
    } else if (raw(cmr.name)) {
      const data = sources.configMaps.get(raw(cmr.name))
      const key = raw(cmr.key)
      out.set(name, {
        name,
        value: data?.[key] ?? `configmap(${raw(cmr.name)})`,
        source: raw(cmr.name),
        unresolved: data == null || data[key] === undefined,
      })
    } else if (raw(field.fieldPath)) {
      out.set(name, { name, value: `field(${raw(field.fieldPath)})` })
    } else if (raw(res.resource)) {
      out.set(name, { name, value: `resource(${raw(res.resource)})` })
    } else {
      out.set(name, { name, value: raw(er.value) })
    }
  }

  return [...out.values()]
}

export function EnvRow({ line }: { line: EnvLine }) {
  const [revealed, setRevealed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const hidden = !!line.secret && !revealed
  const display = hidden
    ? `secret(${line.source || 'secret'})`
    : (line.value || '—')

  function onValueClick() {
    if (line.secret) {
      if (hidden) {
        setRevealed(true)
        setExpanded(true)
      } else {
        setExpanded(v => !v)
      }
      return
    }
    setExpanded(v => !v)
  }

  return (
    <div className={'ip-env-row' + (expanded ? ' is-open' : '')}>
      <span className="ip-env-name">{line.name}</span>
      <span className="ip-env-sep">:</span>
      <button type="button" className={'ip-env-val' + (hidden ? ' is-ref' : '')} onClick={onValueClick}>
        {display}
      </button>
      {line.secret && (
        <button
          type="button"
          className="ip-env-eye"
          onClick={() => {
            setRevealed(v => !v)
            setExpanded(false)
          }}
          data-tooltip={hidden ? 'Show value' : 'Hide value'}
        >
          {hidden ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      )}
    </div>
  )
}

/** Card offset inside the scroll content, unaffected by the panel's entrance scale transform. */
function cardOffsetInPanel(el: HTMLElement, body: HTMLElement): number {
  const bodyRect = body.getBoundingClientRect()
  const scale = body.offsetHeight > 0 ? bodyRect.height / body.offsetHeight : 1
  const visual = el.getBoundingClientRect().top - bodyRect.top
  return body.scrollTop + visual / (scale || 1)
}

function scrollCardIntoPanel(el: HTMLElement, durationMs = 380): () => void {
  const body = el.closest('.ip-body') as HTMLElement | null
  if (!body) {
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return () => {}
  }
  const maxTop = () => Math.max(0, body.scrollHeight - body.clientHeight)
  const target = () => Math.min(maxTop(), Math.max(0, cardOffsetInPanel(el, body)))
  // Target is re-read every frame: rows above can still grow/shrink while the panel settles.
  const start = body.scrollTop
  const t0 = performance.now()
  const settleMs = 300
  const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
  let raf = 0
  let cancelled = false
  const frame = (now: number) => {
    if (cancelled) return
    const elapsed = now - t0
    const p = Math.min(1, elapsed / durationMs)
    const to = target()
    body.scrollTop = start + (to - start) * easeInOut(p)
    if (elapsed < durationMs + settleMs) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  const stop = () => {
    cancelled = true
    cancelAnimationFrame(raf)
  }
  body.addEventListener('wheel', stop, { once: true, passive: true })
  body.addEventListener('touchstart', stop, { once: true, passive: true })
  return () => {
    stop()
    body.removeEventListener('wheel', stop)
    body.removeEventListener('touchstart', stop)
  }
}

export function EnvFold({ lines, loading, defaultOpen = false }: {
  lines: EnvLine[]
  loading: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const count = loading && lines.length === 0 ? undefined : lines.length

  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  return (
    <div className="ip-env-section">
      <button type="button" className="ip-env-section-hdr" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="ip-env-section-title">Environment</span>
        {count !== undefined
          ? <span className="ip-env-section-count">{count}</span>
          : <span className="ip-env-section-count">…</span>}
      </button>
      {open && (
        <div className="ip-env-section-body">
          {loading && lines.length === 0 && <div className="ip-env-empty">Loading…</div>}
          {lines.map((line, i) => <EnvRow key={`${line.name}-${i}`} line={line} />)}
        </div>
      )}
    </div>
  )
}

export function ContainerCard({ c, statuses, init, pvcByVolume, sources, onExec, focusEnv }: {
  c: unknown; statuses: unknown[]; init: boolean
  pvcByVolume: Map<string, string>
  sources: EnvSourceMaps
  onExec?: (name: string) => void
  focusEnv?: boolean
}) {
  const cont = rec(c)
  const name  = raw(cont.name)
  const cs    = statuses.find(x => raw(rec(x).name) === name)
  const csr   = rec(cs)
  const cardRef = useRef<HTMLDivElement>(null)

  const { text: stateText, cls: stateCls } = cs ? containerStateInfo(cs) : { text: '—', cls: '' }
  const ready    = csr.ready === true
  const restarts = Number(raw(csr.restartCount) || 0)
  const image    = raw(cont.image)

  const ports = arr(cont.ports).map(p => `${raw(rec(p).containerPort)}/${raw(rec(p).protocol) || 'TCP'}`)
  const hasEnv = arr(cont.env).length > 0 || arr(cont.envFrom).length > 0
  const envLines = hasEnv ? resolveContainerEnv(cont, sources) : []
  const pvcMounts = arr(cont.volumeMounts)
    .map(m => rec(m))
    .flatMap(m => {
      const claim = pvcByVolume.get(raw(m.name))
      return claim ? [formatPvcMount(m, claim)] : []
    })

  const res  = rec(cont.resources)
  const req  = rec(res.requests)
  const lim  = rec(res.limits)
  const cpuReq = raw(req.cpu);  const cpuLim = raw(lim.cpu)
  const memReq = raw(req.memory); const memLim = raw(lim.memory)

  useEffect(() => {
    if (!focusEnv || !sources.loaded) return
    let cancelAnim: (() => void) | undefined
    let cancelled = false
    const delay = window.setTimeout(() => {
      if (cancelled || !cardRef.current) return
      cancelAnim = scrollCardIntoPanel(cardRef.current)
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(delay)
      cancelAnim?.()
    }
  }, [focusEnv, sources.loaded])

  return (
    <div className="ip-container-card" ref={cardRef}>
      <div className="ip-container-header">
        {init && <span className="ip-container-tag">init</span>}
        <span className="ip-container-name">{name}</span>
        {stateText !== '—' && <span className={`ip-container-state ${stateCls}`}>{stateText}</span>}
        <span className={ready ? 'ip-container-ready-yes' : 'ip-container-ready-no'}>
          {ready ? '✓ ready' : '✗ not ready'}
        </span>
        {restarts > 0 && <span className="ip-container-restarts">×{restarts}</span>}
        {onExec && (
          <button className="ip-container-exec-btn" onClick={() => onExec(name)} data-tooltip="Terminal">
            <Terminal size={10} />
          </button>
        )}
      </div>
      <div className="ip-container-rows">
        <div className="ip-container-row"><span className="ip-container-key">Image</span><div className="ip-prop-field ip-prop-scroll"><span className="ip-container-val">{image || '—'}</span></div></div>
        {ports.length > 0 && <div className="ip-container-row"><span className="ip-container-key">Ports</span><div className="ip-prop-field ip-prop-scroll"><span className="ip-container-val">{ports.join(', ')}</span></div></div>}
        {(cpuReq || cpuLim) && <div className="ip-container-row"><span className="ip-container-key">CPU</span><div className="ip-prop-field ip-prop-scroll"><span className="ip-container-val">{cpuReq || '—'} → {cpuLim || '—'}</span></div></div>}
        {(memReq || memLim) && <div className="ip-container-row"><span className="ip-container-key">Memory</span><div className="ip-prop-field ip-prop-scroll"><span className="ip-container-val">{memReq || '—'} → {memLim || '—'}</span></div></div>}
        {pvcMounts.length > 0 && (
          <div className="ip-container-row">
            <span className="ip-container-key">PVC</span>
            <div className="ip-prop-field ip-prop-scroll">
              <span className="ip-container-val">{pvcMounts.join('\n')}</span>
            </div>
          </div>
        )}
        {hasEnv && <EnvFold lines={envLines} loading={!sources.loaded} defaultOpen={!!focusEnv} />}
      </div>
    </div>
  )
}

export function ContainersSection({ spec, status, profile, namespace, onExec, focusEnvContainer }: {
  spec: Record<string, unknown>
  status: Record<string, unknown>
  profile: string
  namespace?: string
  onExec?: (name: string) => void
  focusEnvContainer?: string
}) {
  const containers     = arr(spec.containers)
  const initContainers = arr(spec.initContainers)
  const ephemeral      = arr(spec.ephemeralContainers)
  const csStatuses     = arr(status.containerStatuses)
  const initCsStatuses = arr(status.initContainerStatuses)
  const ephStatuses    = arr(status.ephemeralContainerStatuses)
  const pvcByVolume    = pvcVolumeMap(spec)
  const sources        = useEnvSourceMaps(profile, namespace, spec)

  if (containers.length === 0 && initContainers.length === 0 && ephemeral.length === 0)
    return <div className="ip-empty">No containers</div>

  const card = (c: unknown, statuses: unknown[], init: boolean, key: string) => (
    <ContainerCard
      key={key}
      c={c}
      statuses={statuses}
      init={init}
      pvcByVolume={pvcByVolume}
      sources={sources}
      onExec={onExec}
      focusEnv={!!focusEnvContainer && raw(rec(c).name) === focusEnvContainer}
    />
  )

  return (
    <div className="ip-containers">
      {initContainers.map((c, i) => card(c, initCsStatuses, true, `init-${i}`))}
      {containers.map((c, i) => card(c, csStatuses, false, `c-${i}`))}
      {ephemeral.map((c, i) => card(c, ephStatuses, false, `eph-${i}`))}
    </div>
  )
}

// ── Node pods section ─────────────────────────────────────────────────────────
