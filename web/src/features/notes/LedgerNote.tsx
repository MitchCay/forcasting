import { useMemo, useState } from 'react'
import {
  centsToDollars,
  dollarsToCents,
  formatUSD,
  type LedgerEntry,
  type Note,
} from 'shared'
import { Card } from '../../components/Card'
import { Combobox } from '../../components/Combobox'
import { CategoryPieChart } from '../forecast/CategoryPieChart'
import { useScheduledItems } from '../scheduled/queries'
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useUpdateNote,
} from './queries'

// ── Working draft shape ─────────────────────────────────────────────────
// Each draft has a stable id from the moment it's created until save. The
// trailing empty row is just another draft with empty fields, NOT a
// synthetic special row — that keeps React's keyed reconciler from moving
// focus when the row promotes from empty to filled.
//
// `sign` is stored separately from `amount` so the inline toggle button
// owns the negativity. `amount` is the user's literal absolute-value
// input string (no minus). Defaulting `sign` to 'negative' means new
// entries are expenses unless the user toggles otherwise.

type Sign = 'negative' | 'positive'

interface DraftEntry {
  id: string
  name: string
  category: string
  sign: Sign
  amount: string
}

function newId(): string {
  return crypto.randomUUID()
}

function makeEmptyDraft(): DraftEntry {
  return {
    id: newId(),
    name: '',
    category: '',
    sign: 'negative',
    amount: '',
  }
}

function entryToDraft(e: LedgerEntry): DraftEntry {
  return {
    id: e.id,
    name: e.name,
    category: e.category ?? '',
    sign: e.amountCents < 0 ? 'negative' : 'positive',
    amount:
      e.amountCents === 0
        ? ''
        : Math.abs(centsToDollars(e.amountCents)).toString(),
  }
}

function isEmptyDraft(d: DraftEntry): boolean {
  return (
    d.name.trim() === '' &&
    d.category.trim() === '' &&
    d.amount.trim() === ''
  )
}

// Always guarantee one trailing empty row at the end so the user has a
// permanent target to start typing into.
function ensureTrailing(drafts: DraftEntry[]): DraftEntry[] {
  const last = drafts[drafts.length - 1]
  if (!last || !isEmptyDraft(last)) {
    return [...drafts, makeEmptyDraft()]
  }
  return drafts
}

// An entry counts as a Venmo entry when its name mentions venmo, in any
// casing or surrounded by other text (e.g. "Venmo - rent", "split via venmo").
// Matching the name (rather than the category) is intentional: users type the
// payment method into the entry name as free text.
function isVenmoName(name: string): boolean {
  return /venmo/i.test(name)
}

function parseAmount(raw: string): number {
  if (raw.trim() === '' || raw === '.') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function draftToCents(d: DraftEntry): number {
  const abs = dollarsToCents(parseAmount(d.amount))
  return d.sign === 'negative' ? -abs : abs
}

// Strip everything except digits and a single decimal point. The sign is
// owned by the toggle button, so any typed/pasted minus is dropped here.
// Caps the decimal portion at two digits.
function sanitizeAmount(raw: string): string {
  let s = raw.replace(/[^\d.]/g, '')
  const dotIdx = s.indexOf('.')
  if (dotIdx >= 0) {
    s = s.slice(0, dotIdx + 1) + s.slice(dotIdx + 1).replace(/\./g, '')
  }
  const [intPart, decPart] = s.split('.')
  if (decPart !== undefined && decPart.length > 2) {
    s = (intPart ?? '') + '.' + decPart.slice(0, 2)
  }
  return s
}

// ── LedgerNote: a single note in view + edit modes ──────────────────────

export function LedgerNote({
  note,
  initiallyEditing = false,
  onCancelNew,
}: {
  /** Null when creating; the editor saves via createNote on submit. */
  note: Note | null
  initiallyEditing?: boolean
  /** Invoked when the user cancels a brand-new note so the parent can
      remove it from the list. */
  onCancelNew?: () => void
}) {
  const create = useCreateNote()
  const update = useUpdateNote()
  const del = useDeleteNote()

  const [editing, setEditing] = useState(initiallyEditing)
  // Saved notes can be folded up to just the title row so a long list of
  // weekly ledgers stays scannable. Editing always forces expanded — you
  // can't usefully edit a collapsed table.
  const [collapsed, setCollapsed] = useState(false)
  const [title, setTitle] = useState(note?.title ?? '')
  const [drafts, setDrafts] = useState<DraftEntry[]>(() => {
    const base = note?.content.entries.length
      ? note.content.entries.map(entryToDraft)
      : []
    return ensureTrailing(base)
  })

  // Unified category suggestion list. We pull from every place categories
  // can be defined in the app so the same set surfaces here, in the
  // scheduled-item form, and anywhere else we add a picker later.
  //   1. Scheduled items (the existing source for the scheduled form).
  //   2. Every ledger note's saved entries.
  //   3. The current in-progress drafts (so freshly-typed categories show
  //      up on subsequent rows before save).
  const { data: scheduledItems } = useScheduledItems()
  const { data: allNotes } = useNotes()
  const categorySuggestions = useMemo(() => {
    const seen = new Set<string>()
    for (const it of scheduledItems ?? []) {
      if (it.category && it.category.trim()) seen.add(it.category.trim())
    }
    for (const n of allNotes ?? []) {
      if (n.type !== 'ledger') continue
      for (const e of n.content.entries) {
        if (e.category && e.category.trim()) seen.add(e.category.trim())
      }
    }
    for (const d of drafts) {
      if (d.category.trim()) seen.add(d.category.trim())
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [scheduledItems, allNotes, drafts])

  const onEnterEdit = () => {
    setTitle(note?.title ?? '')
    setDrafts(
      ensureTrailing(
        note?.content.entries.length
          ? note.content.entries.map(entryToDraft)
          : [],
      ),
    )
    setEditing(true)
  }

  const onCancel = () => {
    if (!note) {
      onCancelNew?.()
      return
    }
    setEditing(false)
  }

  const onDelete = () => {
    if (!note) return
    if (confirm(`Delete "${note.title || 'this ledger'}"?`)) {
      del.mutate(note.id)
    }
  }

  const onSave = async () => {
    const entries: LedgerEntry[] = drafts
      .filter((d) => !isEmptyDraft(d))
      .map((d) => ({
        id: d.id,
        name: d.name.trim(),
        category: d.category.trim() || null,
        amountCents: draftToCents(d),
      }))

    const payload = {
      type: 'ledger' as const,
      title: title.trim(),
      content: { entries },
    }

    if (note) {
      await update.mutateAsync({ id: note.id, ...payload })
      setEditing(false)
    } else {
      await create.mutateAsync(payload)
      onCancelNew?.()
    }
  }

  const updateRow = (id: string, patch: Partial<DraftEntry>) => {
    setDrafts((prev) =>
      ensureTrailing(prev.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    )
  }

  const removeRow = (id: string) => {
    setDrafts((prev) => ensureTrailing(prev.filter((d) => d.id !== id)))
  }

  const viewEntries = note?.content.entries ?? []
  const rowsToRender = editing
    ? drafts
    : viewEntries.map(entryToDraft)

  // ── Summary stats ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const source = editing
      ? drafts.filter((d) => !isEmptyDraft(d))
      : viewEntries.map(entryToDraft)
    let total = 0
    let income = 0
    let expenses = 0
    // Net sum of entries whose name indicates a Venmo payment, plus a count
    // so we can hide the stat entirely when there are none.
    let venmo = 0
    let venmoCount = 0
    for (const d of source) {
      const c = draftToCents(d)
      total += c
      if (c > 0) income += c
      else if (c < 0) expenses += -c
      if (isVenmoName(d.name)) {
        venmo += c
        venmoCount += 1
      }
    }
    return { total, income, expenses, venmo, venmoCount, count: source.length }
  }, [editing, drafts, viewEntries])

  // ── Category breakdown for the pie ─────────────────────────────────
  // Bucket EXPENSES (negative entries) by category. New entries default to
  // expense, so this will populate naturally as the user fills in rows.
  const categorySlices = useMemo(() => {
    const source = editing
      ? drafts.filter((d) => !isEmptyDraft(d))
      : viewEntries.map(entryToDraft)
    const m = new Map<string, number>()
    for (const d of source) {
      const cents = draftToCents(d)
      if (cents >= 0) continue
      const cat = d.category.trim() || 'Uncategorized'
      m.set(cat, (m.get(cat) ?? 0) + Math.abs(cents))
    }
    return Array.from(m.entries())
      .map(([category, totalCents]) => ({ category, totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents)
  }, [editing, drafts, viewEntries])

  const titleDisplay = note?.title?.trim() || title.trim() || 'Untitled ledger'

  // Editing forces the body open; otherwise the user controls expand/
  // collapse via the chevron in the actions row.
  const bodyVisible = editing || !collapsed

  return (
    <Card
      title={
        editing ? (
          <input
            className="ledger__title-input"
            value={title}
            placeholder="Untitled ledger"
            onChange={(e) => setTitle(e.target.value)}
          />
        ) : (
          <span className="ledger__title">
            <span>{titleDisplay}</span>
            {collapsed && stats.count > 0 && (
              <span className="ledger__title-summary muted">
                {stats.count} {stats.count === 1 ? 'entry' : 'entries'}
                {' · '}
                <span
                  className={
                    stats.total > 0
                      ? 'positive'
                      : stats.total < 0
                      ? 'negative'
                      : ''
                  }
                >
                  {formatUSD(stats.total)}
                </span>
              </span>
            )}
          </span>
        )
      }
      actions={
        editing ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={create.isPending || update.isPending}
            >
              {create.isPending || update.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onCancel}
              disabled={create.isPending || update.isPending}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {note && (
              <button
                type="button"
                className="ledger__collapse"
                onClick={() => setCollapsed((v) => !v)}
                aria-label={collapsed ? 'Expand' : 'Collapse'}
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand' : 'Collapse'}
              >
                <span className={`ledger__chevron ${collapsed ? '' : 'open'}`}>
                  ▸
                </span>
              </button>
            )}
            <button type="button" className="secondary" onClick={onEnterEdit}>
              Edit
            </button>
            {note && (
              <button
                type="button"
                className="danger"
                onClick={onDelete}
                disabled={del.isPending}
              >
                Delete
              </button>
            )}
          </>
        )
      }
    >
      {bodyVisible && (
      <div className="ledger">
        <div className="ledger__table-wrap">
          <table className="ledger__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th className="ledger__th-amount">Amount</th>
                {editing && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rowsToRender.length === 0 && !editing && (
                <tr>
                  <td colSpan={3} className="muted">
                    No entries yet.
                  </td>
                </tr>
              )}
              {rowsToRender.map((row, idx) => {
                const cents = draftToCents(row)
                const amountClass =
                  cents > 0 ? 'positive' : cents < 0 ? 'negative' : ''
                if (editing) {
                  const isLast = idx === drafts.length - 1
                  const isEmpty = isEmptyDraft(row)
                  const signClass =
                    row.sign === 'negative' ? 'negative' : 'positive'
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          value={row.name}
                          placeholder={isLast && isEmpty ? 'New entry…' : ''}
                          onChange={(e) =>
                            updateRow(row.id, { name: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <Combobox
                          value={row.category}
                          options={categorySuggestions}
                          onChange={(next) =>
                            updateRow(row.id, { category: next })
                          }
                          placeholder="—"
                        />
                      </td>
                      <td>
                        <div className="ledger__amount-wrap">
                          <button
                            type="button"
                            className={`ledger__sign-toggle ${signClass}`}
                            tabIndex={-1}
                            onClick={() =>
                              updateRow(row.id, {
                                sign:
                                  row.sign === 'negative'
                                    ? 'positive'
                                    : 'negative',
                              })
                            }
                            title={
                              row.sign === 'negative'
                                ? 'Expense — click to switch to income'
                                : 'Income — click to switch to expense'
                            }
                            aria-label={
                              row.sign === 'negative'
                                ? 'Switch to income'
                                : 'Switch to expense'
                            }
                          >
                            {row.sign === 'negative' ? '−' : '+'}
                          </button>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.amount}
                            placeholder="0.00"
                            className={`ledger__amount-input ${amountClass}`}
                            onChange={(e) =>
                              updateRow(row.id, {
                                amount: sanitizeAmount(e.target.value),
                              })
                            }
                            onPaste={(e) => {
                              e.preventDefault()
                              const text = e.clipboardData.getData('text')
                              updateRow(row.id, {
                                amount: sanitizeAmount(text),
                              })
                            }}
                          />
                        </div>
                      </td>
                      <td className="ledger__row-actions">
                        {!(isLast && isEmpty) && (
                          <button
                            type="button"
                            className="ledger__remove"
                            tabIndex={-1}
                            onClick={() => removeRow(row.id)}
                            aria-label="Remove row"
                            title="Remove row"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={row.id}>
                    <td>{row.name || <span className="muted">—</span>}</td>
                    <td>
                      {row.category || <span className="muted">—</span>}
                    </td>
                    <td className={`ledger__amount-cell ${amountClass}`}>
                      {formatUSD(cents)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <aside className="ledger__stats">
          <Stat label="Total" cents={stats.total} colorize />
          <Stat label="Income" cents={stats.income} className="positive" />
          <Stat label="Expenses" cents={stats.expenses} className="negative" />
          {stats.venmoCount > 0 && (
            <Stat label="Venmo" cents={stats.venmo} colorize />
          )}
          <Stat label="Entries" plain={stats.count.toString()} />
          {categorySlices.length > 0 && (
            <div className="ledger-categories">
              <div className="ledger-stat__label">Expenses by category</div>
              <CategoryPieChart
                slices={categorySlices}
                height={160}
                orientation="vertical"
              />
            </div>
          )}
        </aside>
      </div>
      )}
    </Card>
  )
}

// ── Stat tile ───────────────────────────────────────────────────────────

function Stat({
  label,
  cents,
  plain,
  className,
  colorize,
}: {
  label: string
  cents?: number
  plain?: string
  className?: string
  colorize?: boolean
}) {
  let valueClass = className ?? ''
  if (colorize && cents != null) {
    if (cents > 0) valueClass = 'positive'
    else if (cents < 0) valueClass = 'negative'
  }
  return (
    <div className="ledger-stat">
      <div className="ledger-stat__label">{label}</div>
      <div className={`ledger-stat__value ${valueClass}`}>
        {plain ?? (cents != null ? formatUSD(cents) : '')}
      </div>
    </div>
  )
}

