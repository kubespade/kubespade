import { useEffect, useRef } from 'react'

/**
 * Opens a workbench tab when `request.seq` advances (same pattern for
 * exec / logs / files open-from-context requests).
 */
export function useWorkbenchRequest<T extends { seq: number }>(
  request: T | null,
  onOpen: (request: T) => void,
) {
  const lastSeqRef = useRef(0)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    if (!request || request.seq === lastSeqRef.current) return
    lastSeqRef.current = request.seq
    onOpenRef.current(request)
  }, [request])
}
