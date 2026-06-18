import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

// A shadcn-style combobox: a button trigger that opens a portal'd popover
// containing a search input + filtered list of options. When `allowCustom`
// is on and the search text doesn't exactly match any option, an "Add 'X'"
// creatable row appears so the user can commit a brand-new value.
//
// Why a portal: when the combobox lives inside a `overflow: auto` parent
// (e.g. our ledger table-wrap), an absolute-positioned panel would get
// clipped. Rendering into document.body via fixed positioning escapes any
// parent overflow.

export interface ComboboxProps {
  value: string
  options: string[]
  onChange: (next: string) => void
  placeholder?: string
  /** Show the "+ Add …" row when search doesn't match. Default true. */
  allowCustom?: boolean
  /** Shown when no options match the search and customs aren't allowed. */
  emptyMessage?: string
  className?: string
}

type Item =
  | { kind: 'option'; value: string }
  | { kind: 'create'; value: string }

export function Combobox({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  allowCustom = true,
  emptyMessage = 'No matches',
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)
  const [placement, setPlacement] = useState<'above' | 'below'>('below')

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Single synchronous close path. We tried to do the reset in a useEffect
  // tied to `open` but the reset ran after the next browser paint, leaving
  // a window where new keystrokes appended onto the stale search from the
  // previous open. Resetting inline here closes that gap.
  const closePopover = useCallback(() => {
    setSearch('')
    setHighlight(0)
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const trimmed = search.trim()
  const lower = trimmed.toLowerCase()

  const filtered = useMemo(() => {
    if (!lower) return options
    return options.filter((o) => o.toLowerCase().includes(lower))
  }, [options, lower])

  const showCreate =
    allowCustom &&
    trimmed.length > 0 &&
    !filtered.some((o) => o.toLowerCase() === lower)

  const items: Item[] = useMemo(() => {
    const list: Item[] = filtered.map((o) => ({ kind: 'option', value: o }))
    if (showCreate) list.push({ kind: 'create', value: trimmed })
    return list
  }, [filtered, showCreate, trimmed])

  // Focus the search input synchronously after React commits the open
  // popover. useLayoutEffect runs before the browser paints, so subsequent
  // keystrokes already land in the input by the time the user can type
  // the next character. (useEffect + queueMicrotask had a race where the
  // SECOND keystroke could still fire on the trigger.)
  useLayoutEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  // Recompute trigger position + flip placement when opening, scrolling,
  // or resizing. We flip above when there isn't enough room below AND
  // there's more room above — keeps the popover on-screen near the
  // bottom of long pages.
  useEffect(() => {
    if (!open) return
    const measure = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      setTriggerRect(rect)
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const flip = spaceBelow < 240 && spaceAbove > spaceBelow
      setPlacement(flip ? 'above' : 'below')
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open])

  // Clamp highlight when items shrink.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, items.length - 1)))
  }, [items.length])

  // Outside click. Trigger + portal panel are two separate DOM subtrees, so
  // we check both refs explicitly.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        // Outside click — just close, don't refocus the trigger (we don't
        // want to steal focus from whatever the user is clicking on).
        setSearch('')
        setHighlight(0)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const selectItem = (item: Item) => {
    onChange(item.value)
    closePopover()
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePopover()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[highlight]
      if (item) selectItem(item)
    }
  }

  // Trigger-level keys. The button is the tab target; typing while focused
  // should open the popover and route the keystroke straight into the
  // search field rather than forcing the user to click/Enter first.
  const handleTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return

    // Arrow keys + Enter / Space: open the popover (no seed).
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'Enter' ||
      e.key === ' '
    ) {
      e.preventDefault()
      setOpen(true)
      return
    }

    // Printable single character: open AND append it to search. We use a
    // functional update because rapid typing can fire multiple keystrokes
    // on the trigger before React renders and shifts focus to the input
    // — without functional update, each subsequent key would clobber the
    // previous (typing "ca" would leave search="a"). Once focus shifts
    // to the input on the next render, its onChange takes over.
    if (e.key.length === 1) {
      e.preventDefault()
      setSearch((prev) => prev + e.key)
      setHighlight(0)
      setOpen(true)
    }
  }

  const triggerLabel = value || placeholder

  return (
    <div className={`combobox ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="combobox__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKey}
      >
        <span className={value ? '' : 'combobox__placeholder'}>
          {triggerLabel}
        </span>
        <span className="combobox__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && triggerRect &&
        createPortal(
          <div
            ref={panelRef}
            className="combobox__panel"
            role="listbox"
            style={{
              position: 'fixed',
              left: triggerRect.left,
              width: Math.max(triggerRect.width, 200),
              // Flip above when there's not enough room below. Using bottom
              // instead of top for the above-case lets the panel grow
              // upward without needing to know its rendered height.
              ...(placement === 'above'
                ? {
                    bottom: window.innerHeight - triggerRect.top + 4,
                    maxHeight: Math.min(triggerRect.top - 8, 320),
                  }
                : {
                    top: triggerRect.bottom + 4,
                    maxHeight: Math.min(
                      window.innerHeight - triggerRect.bottom - 8,
                      320,
                    ),
                  }),
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={search}
              placeholder="Search or add…"
              className="combobox__search"
              onChange={(e) => {
                setSearch(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={handleKey}
            />
            <ul className="combobox__list">
              {items.length === 0 && (
                <li className="combobox__empty">
                  {trimmed ? emptyMessage : 'Type to add a new category'}
                </li>
              )}
              {items.map((item, idx) => {
                const active = idx === highlight
                return (
                  <li
                    key={`${item.kind}-${item.value}`}
                    className={`combobox__item ${active ? 'active' : ''}`}
                    onMouseEnter={() => setHighlight(idx)}
                    // mousedown so the selection registers before the
                    // outside-click handler closes the panel.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectItem(item)
                    }}
                    role="option"
                    aria-selected={active}
                  >
                    {item.kind === 'create' ? (
                      <span>
                        + Add{' '}
                        <span className="combobox__create-value">
                          &quot;{item.value}&quot;
                        </span>
                      </span>
                    ) : (
                      item.value
                    )}
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
