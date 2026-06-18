import { useMemo, useState } from 'react'
import {
  formatUSD,
  frequencyLabels,
  todayISO,
  type Account,
  type ScheduledItem,
} from 'shared'
import { Card } from '../../components/Card'
import { useAccounts } from '../accounts/queries'
import {
  useDeleteScheduledItem,
  useScheduledItems,
} from './queries'
import { ScheduledItemForm } from './ScheduledItemForm'

// An item is "past" if it's a one-time entry whose date has passed, OR a
// recurring item whose end date has passed. Active items everywhere else.
function isPast(item: ScheduledItem, today: string): boolean {
  if (item.frequency === 'one_time') return item.startDate < today
  return !!item.endDate && item.endDate < today
}

export function ScheduledItemList() {
  const { data: items, isLoading, error } = useScheduledItems()
  const { data: accounts } = useAccounts()

  const accountById = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts ?? []) m.set(a.id, a)
    return m
  }, [accounts])

  if (isLoading) return <p className="muted">Loading scheduled items…</p>
  if (error) {
    return <div className="error-banner">{(error as Error).message}</div>
  }
  if (!items || items.length === 0) {
    return <p className="muted">No scheduled items yet.</p>
  }

  const today = todayISO()
  const active = items.filter((i) => !isPast(i, today))
  const past = items.filter((i) => isPast(i, today))

  const renderRow = (it: ScheduledItem) => (
    <ScheduledItemRow
      key={it.id}
      item={it}
      accountName={accountById.get(it.accountId)?.name}
    />
  )

  // Group active items by income vs expense; past items collapse into a
  // closed-by-default <details> at the bottom of the page.
  const income = active.filter((i) => i.isIncome)
  const expenses = active.filter((i) => !i.isIncome)

  return (
    <div>
      {income.length > 0 && (
        <Section title="Income">{income.map(renderRow)}</Section>
      )}
      {expenses.length > 0 && (
        <Section title="Expenses">{expenses.map(renderRow)}</Section>
      )}
      {active.length === 0 && (
        <p className="muted">No active scheduled items.</p>
      )}
      {past.length > 0 && (
        <details className="archived-section">
          <summary>
            Past items{' '}
            <span className="muted">
              ({past.length})
            </span>
          </summary>
          <div className="archived-section__body">{past.map(renderRow)}</div>
        </details>
      )}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
        {title}
      </h3>
      <div>{children}</div>
    </div>
  )
}

function ScheduledItemRow({
  item,
  accountName,
}: {
  item: ScheduledItem
  accountName?: string
}) {
  const [editing, setEditing] = useState(false)
  const del = useDeleteScheduledItem()

  const amountClass = item.isIncome ? 'positive' : 'negative'
  const sign = item.isIncome ? '+' : '−'
  const amountText = `${sign}${formatUSD(item.amountCents).replace(/^-/, '')}`

  const datesLabel =
    item.frequency === 'one_time'
      ? `On ${item.startDate}`
      : item.endDate
      ? `${item.startDate} → ${item.endDate}`
      : `From ${item.startDate}`

  const handleDelete = () => {
    if (confirm(`Delete "${item.name}"?`)) {
      del.mutate(item.id)
    }
  }

  return (
    <Card
      title={
        <span>
          {item.name}{' '}
          <span className="muted">
            · {frequencyLabels[item.frequency]}
            {accountName ? ` · ${accountName}` : ''}
          </span>
        </span>
      }
      actions={
        <>
          <span className={`amount ${amountClass}`}>{amountText}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Hide' : 'Edit'}
          </button>
          <button
            type="button"
            className="danger"
            onClick={handleDelete}
            disabled={del.isPending}
          >
            Delete
          </button>
        </>
      }
    >
      {editing ? (
        <ScheduledItemForm item={item} onSuccess={() => setEditing(false)} />
      ) : (
        <div className="muted" style={{ fontSize: '0.9rem' }}>
          {datesLabel}
          {item.category ? ` · ${item.category}` : ''}
          {item.notes ? ` · ${item.notes}` : ''}
        </div>
      )}
    </Card>
  )
}
