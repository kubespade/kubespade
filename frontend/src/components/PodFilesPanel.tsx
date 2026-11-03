import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  ChevronRight,
  File,
  Folder,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { api } from '../api/client'
import { buildContainerTabs, ContainerTabs } from './ContainerTabs'
import { formatRemoteSize, joinRemote, parentRemote, pathParts } from '../lib/remotePath'
import { usePodContainers } from '../hooks/usePodContainers'
import { usePodFileTransfer } from '../hooks/usePodFileTransfer'

export type FilesTarget = {
  podName: string
  namespace?: string
  container?: string
}

interface DirEntry {
  name: string
  kind: 'file' | 'dir'
  size: number
}

interface Props {
  profile: string
  target: FilesTarget
  active: boolean
}

export function PodFilesPanel({ profile, target, active }: Props) {
  const {
    containerList,
    activeContainer,
    setActiveContainer,
    error: containersError,
  } = usePodContainers(profile, target.podName, target.namespace, target.container, active)
  const [cwd, setCwd] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [dropArmed, setDropArmed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [nameFilter, setNameFilter] = useState('')
  const [awaitingSearch, setAwaitingSearch] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const activeContainerRef = useRef(activeContainer)
  activeContainerRef.current = activeContainer

  useEffect(() => {
    if (containersError) setListError(containersError)
  }, [containersError])

  const refresh = useCallback(async (
    dir = cwd,
    container = activeContainer,
    filter = nameFilter,
  ) => {
    if (!container || !target.podName) return
    setLoading(true)
    setListError('')
    const q = filter.trim()
    try {
      const res = await api.listPodFiles(profile, target.podName, {
        namespace: target.namespace,
        container,
        remotePath: dir,
        nameFilter: q || undefined,
      })
      setEntries(res.entries || [])
      setTruncated(!!res.truncated)
      if (dir !== cwdRef.current) setNameFilter('')
      setCwd(dir)
      setSelected(null)
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : 'Failed to list directory')
      setEntries([])
    } finally {
      setLoading(false)
      setAwaitingSearch(false)
    }
  }, [profile, target.podName, target.namespace, cwd, activeContainer, nameFilter])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const transfer = usePodFileTransfer({
    profile,
    podName: target.podName,
    namespace: target.namespace,
    getContainer: () => activeContainerRef.current,
    getRemoteDir: () => cwdRef.current,
    onAfterSuccess: () => refreshRef.current(cwdRef.current, activeContainerRef.current),
  })
  const { busy, message: transferMsg } = transfer
  const error = transfer.error || listError

  useEffect(() => {
    if (!activeContainer) return
    void refresh('/', activeContainer, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContainer])

  useEffect(() => {
    if (active && activeContainer) void refresh(cwd, activeContainer, nameFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Server-side name search over the whole directory (not only the first 2000 browse rows).
  // Skip only the first run after container is ready (initial list comes from other effects).
  // Important: do not skip when !activeContainer — that used to eat the first paste/type.
  const filterSkipOnceRef = useRef(true)
  useEffect(() => {
    filterSkipOnceRef.current = true
  }, [profile, target.podName, target.namespace])
  useEffect(() => {
    if (!active || !activeContainer) return
    if (filterSkipOnceRef.current) {
      filterSkipOnceRef.current = false
      // User may have typed while containers were still loading — still search.
      if (!nameFilter.trim()) return
    }
    setAwaitingSearch(true)
    const handle = window.setTimeout(() => {
      void refresh(cwdRef.current, activeContainer, nameFilter)
    }, 200)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameFilter, active, activeContainer])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
        filterRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  async function pullEntry(entry: DirEntry) {
    if (!activeContainer || !target.podName) return
    await transfer.pullRemotePath(joinRemote(cwd, entry.name), entry.kind, {
      defaultName: entry.name,
    })
  }

  async function pullSelected() {
    const entry = entries.find(e => e.name === selected)
    if (entry) await pullEntry(entry)
  }

  const filterQ = nameFilter.trim()
  const listBusy = loading || awaitingSearch
  const crumbs = pathParts(cwd)
  const allTabs = buildContainerTabs(containerList)

  return (
    <div className={`pod-files${active ? ' pod-files-active' : ''}${loading ? ' pod-files-loading' : ''}`}>
      <ContainerTabs
        tabs={allTabs}
        active={activeContainer}
        variant="files"
        disabled={busy}
        onSelect={setActiveContainer}
      />

      <div className="pod-files-toolbar">
        <div className="pod-files-nav">
          <button
            type="button"
            className="pod-files-icon-btn"
            disabled={cwd === '/' || busy}
            onClick={() => void refresh(parentRemote(cwd), activeContainer, '')}
            title="Parent folder"
          >
            <ArrowUp size={15} strokeWidth={2} />
          </button>
          <nav className="pod-files-crumbs" aria-label="Path">
            {crumbs.map((c, i) => (
              <span key={c.path} className="pod-files-crumb-wrap">
                {i > 0 && <ChevronRight size={12} className="pod-files-crumb-sep" aria-hidden />}
                <button
                  type="button"
                  className={`pod-files-crumb${i === crumbs.length - 1 ? ' pod-files-crumb-current' : ''}`}
                  disabled={busy || i === crumbs.length - 1}
                  onClick={() => void refresh(c.path, activeContainer, '')}
                  title={c.path}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className={`pod-files-search${listBusy ? ' pod-files-search-busy' : ''}`}>
          {listBusy ? (
            <Loader2 size={14} className="pod-files-search-icon pod-files-spin" aria-hidden />
          ) : (
            <Search size={14} className="pod-files-search-icon" aria-hidden />
          )}
          <input
            ref={filterRef}
            type="search"
            value={nameFilter}
            onChange={e => {
              setNameFilter(e.target.value)
              setSelected(null)
              // Immediate feedback — do not wait for the debounced effect.
              if (activeContainer) setAwaitingSearch(true)
            }}
            placeholder="Filter by name in this folder…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Filter by name"
            aria-busy={listBusy}
          />
          {listBusy ? (
            <span className="pod-files-search-busy-label">
              {filterQ ? 'Searching…' : 'Loading…'}
            </span>
          ) : nameFilter ? (
            <button
              type="button"
              className="pod-files-search-clear"
              onClick={() => { setNameFilter(''); filterRef.current?.focus() }}
              aria-label="Clear filter"
            >
              <X size={13} />
            </button>
          ) : (
            <kbd className="pod-files-search-kbd">
              {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
                ? '⌘F'
                : 'Ctrl+F'}
            </kbd>
          )}
        </div>

        <div className="pod-files-actions">
          <button
            type="button"
            className="pod-files-action"
            disabled={busy || !selected}
            onClick={() => void pullSelected()}
            title="Download selected"
          >
            <ArrowDownToLine size={14} strokeWidth={2} />
            Pull
          </button>
          <button
            type="button"
            className="pod-files-action pod-files-action-primary"
            disabled={busy}
            onClick={() => void transfer.openPushDialog(cwd)}
            title={`Upload into ${cwd}`}
          >
            <ArrowUpFromLine size={14} strokeWidth={2} />
            Push
          </button>
        </div>
      </div>

      {(transferMsg || error || (listBusy && filterQ)) && (
        <div className={`pod-files-status${error ? ' pod-files-status-error' : ''}${listBusy && filterQ && !error ? ' pod-files-status-busy' : ''}`}>
          {error || transferMsg || (
            <span className="pod-files-status-busy-row">
              <Loader2 size={13} className="pod-files-spin" aria-hidden />
              Searching all names in this folder… large directories can take a while
            </span>
          )}
        </div>
      )}

      {truncated && !listBusy && (
        <div className="pod-files-truncated">
          {filterQ
            ? `Showing first ${entries.length} matches — refine the filter to narrow results.`
            : `Showing first ${entries.length} entries — filter by name to search the whole folder.`}
        </div>
      )}

      <div
        className={`pod-files-body${dropArmed ? ' pod-files-body-drop' : ''}${listBusy ? ' pod-files-body-busy' : ''}`}
        aria-busy={listBusy}
        onDragEnter={e => { e.preventDefault(); setDropArmed(true) }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropArmed(true) }}
        onDragLeave={e => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDropArmed(false)
        }}
        onDrop={e => {
          setDropArmed(false)
          void transfer.handleFileDrop(e)
        }}
      >
        {listBusy && entries.length === 0 ? (
          <div className="pod-files-empty">
            <Loader2 size={28} strokeWidth={1.75} className="pod-files-spin" />
            <p>{filterQ ? 'Searching…' : 'Loading…'}</p>
            <span>{filterQ ? 'Scanning names in this folder' : 'Reading directory'}</span>
          </div>
        ) : entries.length === 0 && filterQ ? (
          <div className="pod-files-empty">
            <Search size={28} strokeWidth={1.5} />
            <p>No matches</p>
            <span>Nothing in this folder matches “{filterQ}”</span>
          </div>
        ) : (
          <ul className="pod-files-list" role="list">
            {cwd !== '/' && (
              <li>
                <button
                  type="button"
                  className="pod-files-row pod-files-row-up"
                  onClick={() => void refresh(parentRemote(cwd), activeContainer, '')}
                  onDoubleClick={() => void refresh(parentRemote(cwd), activeContainer, '')}
                  title={`Go to ${parentRemote(cwd)}`}
                >
                  <span className="pod-files-row-icon is-dir">
                    <Folder size={16} strokeWidth={2} />
                  </span>
                  <span className="pod-files-row-name">../</span>
                  <span className="pod-files-row-size" />
                  <span className="pod-files-row-pull" aria-hidden />
                </button>
              </li>
            )}
            {entries.length === 0 ? (
              <li className="pod-files-list-empty-hint">Empty folder — drop files here or use Push</li>
            ) : (
              entries.map(entry => {
                const sizeLabel = entry.kind === 'file' ? formatRemoteSize(entry.size) : ''
                return (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className={`pod-files-row${selected === entry.name ? ' pod-files-row-selected' : ''}`}
                      onClick={() => setSelected(entry.name)}
                      onDoubleClick={() => {
                        if (entry.kind === 'dir') void refresh(joinRemote(cwd, entry.name), activeContainer, '')
                        else void pullEntry(entry)
                      }}
                    >
                      <span className={`pod-files-row-icon${entry.kind === 'dir' ? ' is-dir' : ''}`}>
                        {entry.kind === 'dir' ? <Folder size={16} strokeWidth={2} /> : <File size={16} strokeWidth={2} />}
                      </span>
                      <span className="pod-files-row-name" title={entry.name}>{entry.name}</span>
                      {sizeLabel ? <span className="pod-files-row-size">{sizeLabel}</span> : <span className="pod-files-row-size" />}
                      <span
                        className="pod-files-row-pull"
                        role="button"
                        tabIndex={-1}
                        title={`Pull ${entry.name}`}
                        onClick={e => { e.stopPropagation(); void pullEntry(entry) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            void pullEntry(entry)
                          }
                        }}
                      >
                        <ArrowDownToLine size={14} strokeWidth={2} />
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
        {dropArmed && (
          <div className="pod-files-drop-hint" aria-hidden>
            Drop to upload into <code>{cwd}</code>
          </div>
        )}
      </div>

      <div className="pod-files-footer">
        {listBusy && filterQ
          ? `Searching for “${filterQ}”…`
          : filterQ
            ? `${entries.length}${truncated ? '+' : ''} match${entries.length === 1 ? '' : 'es'} for “${filterQ}”`
            : `${entries.length}${truncated ? '+' : ''} items`}
        {!listBusy && selected ? ` · selected ${selected}` : ''}
      </div>
    </div>
  )
}

/** Label for workbench Files tab. */
export function filesTabLabel(target: FilesTarget): string {
  return target.container ? `${target.podName} / files` : `${target.podName} · Files`
}
