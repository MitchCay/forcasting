import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Switch } from '../../components/Switch'
import { CategoryPieChart } from '../forecast/CategoryPieChart'
import { LedgerNote } from './LedgerNote'
import {
  computeLedgerStats,
  LedgerStatsRow,
  sumLedgerStats,
} from './LedgerStats'
import { useNotes } from './queries'

// Lightweight client-side "draft" sentinel: when the user clicks "Add new
// note", we render a LedgerNote with null `note` and `initiallyEditing`
// true. Saving turns it into a real note on the server; cancelling drops
// the draft.

// Persist the combined-stats card visibility across sessions.
const COMBINED_CARD_KEY = 'notes.showCombinedCard'

function readShowCombined(): boolean {
  try {
    // Default to shown when nothing has been stored yet.
    return localStorage.getItem(COMBINED_CARD_KEY) !== 'false'
  } catch {
    return true
  }
}

export function NotesPage() {
  const { data: notes, isLoading, error } = useNotes()
  const [drafting, setDrafting] = useState(false)

  // Collapse state is lifted here so the header's collapse-all / expand-all
  // button can drive every note at once, while each note's own chevron still
  // toggles just itself.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  // Combined-stats card visibility — persisted in localStorage.
  const [showCombined, setShowCombined] = useState(readShowCombined)
  useEffect(() => {
    try {
      localStorage.setItem(COMBINED_CARD_KEY, showCombined ? 'true' : 'false')
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [showCombined])

  const ledgerNotes = useMemo(
    () => (notes ?? []).filter((n) => n.type === 'ledger'),
    [notes],
  )

  // Notes start collapsed. We seed the collapsed set once, the first time
  // notes arrive, so the initial view is fully folded — the user can then
  // expand individually or via "Expand all".
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    if (ledgerNotes.length === 0) return
    setCollapsedIds(new Set(ledgerNotes.map((n) => n.id)))
    seeded.current = true
  }, [ledgerNotes])

  const allCollapsed =
    ledgerNotes.length > 0 && ledgerNotes.every((n) => collapsedIds.has(n.id))

  const toggleAll = () => {
    if (allCollapsed) setCollapsedIds(new Set())
    else setCollapsedIds(new Set(ledgerNotes.map((n) => n.id)))
  }

  const toggleOne = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Combined stats across every ledger note. Entry count is intentionally
  // dropped from the card per the design.
  const combinedStats = useMemo(
    () =>
      sumLedgerStats(
        ledgerNotes.map((n) => computeLedgerStats(n.content.entries)),
      ),
    [ledgerNotes],
  )

  // Combined expenses-by-category across all notes, for the pie on the card.
  const combinedCategorySlices = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of ledgerNotes) {
      for (const e of n.content.entries) {
        if (e.amountCents >= 0) continue
        const cat = (e.category ?? '').trim() || 'Uncategorized'
        m.set(cat, (m.get(cat) ?? 0) + Math.abs(e.amountCents))
      }
    }
    return Array.from(m.entries())
      .map(([category, totalCents]) => ({ category, totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents)
  }, [ledgerNotes])

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          border: 'none',
          padding: 0,
          marginBottom: '1rem',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Notes</h2>
          <p className="muted" style={{ margin: '0.15rem 0 0' }}>
            Side notes that don't drive the forecast — useful for shared
            reviews, weekly spend tracking, and the like.
          </p>
        </div>
        <div className="notes-header__actions">
          {ledgerNotes.length > 0 && (
            <button type="button" className="secondary" onClick={toggleAll}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          <Switch
            checked={showCombined}
            onChange={setShowCombined}
            label="Totals"
            title="Show combined totals card"
          />
          <button
            type="button"
            className={drafting ? 'secondary' : ''}
            onClick={() => setDrafting((v) => !v)}
            disabled={drafting}
            title={drafting ? 'Already drafting a new note' : 'Add new note'}
          >
            + Add new note
          </button>
        </div>
      </header>

      {showCombined && ledgerNotes.length > 0 && (
        <div className="notes-combined">
          <Card title="All notes — combined">
            <div className="notes-combined__body">
              <LedgerStatsRow stats={combinedStats} />
              {combinedCategorySlices.length > 0 && (
                <CategoryPieChart
                  slices={combinedCategorySlices}
                  height={180}
                  orientation="horizontal"
                />
              )}
            </div>
          </Card>
        </div>
      )}

      {drafting && (
        <LedgerNote
          note={null}
          initiallyEditing
          onCancelNew={() => setDrafting(false)}
        />
      )}

      {isLoading && <p className="muted">Loading notes…</p>}
      {error && (
        <div className="error-banner">{(error as Error).message}</div>
      )}
      {notes &&
        notes.length === 0 &&
        !drafting && <p className="muted">No notes yet.</p>}
      {notes &&
        notes.map((n) => (
          <LedgerNote
            key={n.id}
            note={n}
            collapsed={collapsedIds.has(n.id)}
            onToggleCollapse={() => toggleOne(n.id)}
          />
        ))}
    </div>
  )
}
