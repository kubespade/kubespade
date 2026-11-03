import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/**
 * Horizontal table scroll area.
 * Bleeds to the viewport right edge; a fixed trailing gutter inside scroll
 * content reveals the end (padding + rounded corner) without toggling layout.
 */
export function TableScrollWrap({ children }: Props) {
  return (
    <div className="cv-table-wrap">
      <div className="cv-table-inner">
        {children}
      </div>
    </div>
  )
}
