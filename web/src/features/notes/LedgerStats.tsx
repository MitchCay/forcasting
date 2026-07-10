import { formatUSD } from 'shared'

// ── Shared ledger stat primitives ───────────────────────────────────────
// Extracted from LedgerNote so the collapsed per-note row, the expanded
// aside, and the pinned combined-stats card on NotesPage all compute and
// render the same numbers the same way.

export interface LedgerStats {
  total: number
  income: number
  expenses: number
  // Net sum of entries whose name indicates a Venmo payment, plus a count so
  // callers can hide the stat entirely when there are none.
  venmo: number
  venmoCount: number
  count: number
}

// An entry counts as a Venmo entry when its name mentions venmo, in any
// casing or surrounded by other text (e.g. "Venmo - rent", "split via venmo").
export function isVenmoName(name: string): boolean {
  return /venmo/i.test(name)
}

// Computes summary stats over a set of saved-shape entries ({ name, amountCents }).
export function computeLedgerStats(
  entries: { name: string; amountCents: number }[],
): LedgerStats {
  let total = 0
  let income = 0
  let expenses = 0
  let venmo = 0
  let venmoCount = 0
  for (const e of entries) {
    const c = e.amountCents
    total += c
    if (c > 0) income += c
    else if (c < 0) expenses += -c
    if (isVenmoName(e.name)) {
      venmo += c
      venmoCount += 1
    }
  }
  return { total, income, expenses, venmo, venmoCount, count: entries.length }
}

// Sums several already-computed stat blocks into one (used for the combined
// all-notes card).
export function sumLedgerStats(all: LedgerStats[]): LedgerStats {
  return all.reduce<LedgerStats>(
    (acc, s) => ({
      total: acc.total + s.total,
      income: acc.income + s.income,
      expenses: acc.expenses + s.expenses,
      venmo: acc.venmo + s.venmo,
      venmoCount: acc.venmoCount + s.venmoCount,
      count: acc.count + s.count,
    }),
    { total: 0, income: 0, expenses: 0, venmo: 0, venmoCount: 0, count: 0 },
  )
}

// ── Stat tile ─────────────────────────────────────────────────────────────

export function Stat({
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

// ── Horizontal stats row ────────────────────────────────────────────────
// Same tiles as the expanded aside, laid out horizontally. Used for the
// collapsed per-note summary and the pinned combined card.

export function LedgerStatsRow({
  stats,
  showEntries = false,
}: {
  stats: LedgerStats
  /** Whether to include the entry-count tile (omitted on the combined card). */
  showEntries?: boolean
}) {
  return (
    <div className="ledger-stats-row">
      <Stat label="Total" cents={stats.total} colorize />
      <Stat label="Income" cents={stats.income} className="positive" />
      <Stat label="Expenses" cents={stats.expenses} className="negative" />
      {stats.venmoCount > 0 && (
        <Stat label="Venmo" cents={stats.venmo} colorize />
      )}
      {showEntries && <Stat label="Entries" plain={stats.count.toString()} />}
    </div>
  )
}
