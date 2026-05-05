import { type ReactNode } from 'react'

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  // Only render the body when there's actual content. Otherwise an empty
  // .card__body div still contributes its padding and makes the header look
  // top-aligned within the card.
  const hasBody = children !== undefined && children !== null && children !== false
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__header">
          {title && <h3>{title}</h3>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {hasBody && <div className="card__body">{children}</div>}
    </section>
  )
}
