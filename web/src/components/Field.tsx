import { type ReactNode } from 'react'

type Props = {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

// Wraps a label, control, and (optional) error/hint underneath. Lets form
// fields look consistent without every form repeating the layout.
export function Field({ label, error, hint, children }: Props) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? (
        <span className="field__error">{error}</span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </label>
  )
}
