import { useEffect, type ReactNode } from 'react'

// Lightweight modal — backdrop click + Escape key close, body scroll locked
// while open. No portal (this is a single-page app and our z-index is well
// understood); the modal renders inline as the last child of `<body>` via
// fixed positioning + a high z-index.

export function Modal({
  open,
  onClose,
  title,
  children,
  width,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Optional max-width override; defaults to a comfortable 480px. */
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Prevent the page from scrolling underneath the modal.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: width ?? 480 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
