import { type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../hooks/useEscapeKey'

/**
 * Shared modal shell. Renders the exact same two-element portal used by the
 * dialog family — a full-screen backdrop plus a content container — as direct
 * children of `document.body` via `createPortal`.
 *
 * Props reproduce each call site's existing behaviour verbatim:
 * - `className` / `backdropClassName` are passed through unchanged so the
 *   rendered class names (and therefore CSS/z-index) stay identical.
 * - `dismissTrigger` selects the pointer event that dismisses via the backdrop
 *   (`mousedown` matches ConfirmDialog-style dialogs, `click` the rest).
 * - `dismissOnBackdrop` / `stopContentPropagation` toggle the backdrop dismiss
 *   handler and the content's `stopPropagation` guard.
 * - `closeOnEscape` wires document-level Escape through the existing
 *   `useEscapeKey` hook (set to false for dialogs that handle Escape locally or
 *   not at all).
 *
 * Any remaining props (`style`, `onKeyDown`, `role`, `aria-*`, …) are spread
 * onto the content container so per-site attributes are preserved.
 */
interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  onClose: () => void
  className?: string
  backdropClassName?: string
  /** Optional wrapper around backdrop+content (e.g. workbench floating logs). */
  wrapperClassName?: string
  dismissOnBackdrop?: boolean
  dismissTrigger?: 'mousedown' | 'click'
  closeOnEscape?: boolean
  stopContentPropagation?: boolean
}

export function Modal({
  onClose,
  className,
  backdropClassName = 'overlay-backdrop',
  wrapperClassName,
  dismissOnBackdrop = true,
  dismissTrigger = 'mousedown',
  closeOnEscape = true,
  stopContentPropagation = true,
  children,
  ...rest
}: ModalProps) {
  useEscapeKey(onClose, closeOnEscape)

  const backdropHandler = dismissOnBackdrop ? onClose : undefined
  const contentHandler = stopContentPropagation
    ? (e: React.SyntheticEvent) => e.stopPropagation()
    : undefined

  const backdropProps = dismissTrigger === 'mousedown'
    ? { onMouseDown: backdropHandler }
    : { onClick: backdropHandler }
  const contentProps = dismissTrigger === 'mousedown'
    ? { onMouseDown: contentHandler }
    : { onClick: contentHandler }

  const nodes = (
    <>
      <div className={backdropClassName} {...backdropProps} />
      <div className={className} {...rest} {...contentProps}>
        {children}
      </div>
    </>
  )

  return createPortal(
    wrapperClassName ? <div className={wrapperClassName}>{nodes}</div> : nodes,
    document.body,
  )
}
