/**
 * App shell uses CSS `zoom: var(--ui-zoom)` on body. Under WebKit/Chromium,
 * getBoundingClientRect() returns visual (zoomed) pixels, while position:fixed
 * left/top on descendants of the zoomed body are in unzoomed layout space.
 * Divide by --ui-zoom when placing portals / fixed tooltips.
 */
export function readUiZoom(): number {
  const fromVar = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim() || '',
  )
  if (Number.isFinite(fromVar) && fromVar > 0) return fromVar
  const fromZoom = parseFloat(getComputedStyle(document.body).zoom || '')
  if (Number.isFinite(fromZoom) && fromZoom > 0) return fromZoom
  return 1
}

/** Center-top of an element, in coordinates suitable for position:fixed under UI zoom. */
export function fixedAnchorCenterTop(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const z = readUiZoom()
  return {
    x: (r.left + r.width / 2) / z,
    y: r.top / z,
  }
}

/** Full rect in fixed-layout coordinates under UI zoom. */
export function fixedRect(el: Element): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const r = el.getBoundingClientRect()
  const z = readUiZoom()
  return {
    left: r.left / z,
    top: r.top / z,
    right: r.right / z,
    bottom: r.bottom / z,
    width: r.width / z,
    height: r.height / z,
  }
}
