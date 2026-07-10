import { type ReactNode } from 'react'

// A small on/off switch — a checkbox styled as a sliding toggle. Used for
// show/hide + expand controls across the app.
export function Switch({
  checked,
  onChange,
  label,
  title,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  title?: string
  disabled?: boolean
}) {
  return (
    <label className={`switch ${disabled ? 'switch--disabled' : ''}`} title={title}>
      <input
        type="checkbox"
        className="switch__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      {label && <span className="switch__label">{label}</span>}
    </label>
  )
}
