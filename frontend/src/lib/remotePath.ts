/** Remote (pod) path helpers shared by files browser and exec transfer. */

export function formatRemoteSize(n: number): string {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function joinRemote(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/+$/, '')}/${name}`
}

export function parentRemote(dir: string): string {
  if (dir === '/') return '/'
  const cleaned = dir.replace(/\/+$/, '')
  const i = cleaned.lastIndexOf('/')
  if (i <= 0) return '/'
  return cleaned.slice(0, i)
}

export function pathParts(dir: string): { label: string; path: string }[] {
  if (dir === '/') return [{ label: '/', path: '/' }]
  const segs = dir.replace(/\/+$/, '').split('/').filter(Boolean)
  const out: { label: string; path: string }[] = [{ label: '/', path: '/' }]
  let acc = ''
  for (const s of segs) {
    acc += `/${s}`
    out.push({ label: s, path: acc })
  }
  return out
}
