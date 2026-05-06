import { useMemo } from 'react'
import { useController, type Control, type FieldValues, type Path } from 'react-hook-form'

// A free-form text input paired with quick-pick chips for the user's
// existing categories. Chips filter live as the user types; clicking one
// fills the input.

export function CategoryPicker<TFieldValues extends FieldValues>({
  control,
  name,
  suggestions,
}: {
  control: Control<TFieldValues>
  name: Path<TFieldValues>
  suggestions: string[]
}) {
  const { field } = useController({ control, name })
  const value = (field.value as string | undefined) ?? ''

  const trimmed = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!trimmed) return suggestions
    return suggestions.filter((s) => s.toLowerCase().includes(trimmed))
  }, [suggestions, trimmed])

  // Don't suggest the value the user has already typed exactly — there's
  // nothing to "pick".
  const visibleChips = filtered.filter((s) => s.toLowerCase() !== trimmed)

  return (
    <div>
      <input
        type="text"
        value={value}
        maxLength={50}
        placeholder="Type a category…"
        onChange={(e) => field.onChange(e.target.value)}
      />
      {visibleChips.length > 0 && (
        <div className="chip-row" aria-label="Existing categories">
          {visibleChips.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              // mousedown so the chip click registers before any blur logic
              onMouseDown={(e) => {
                e.preventDefault()
                field.onChange(c)
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
