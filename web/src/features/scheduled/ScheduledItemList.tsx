import { useMemo, useState } from 'react'
import {
  formatUSD,
  frequencyLabels,
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

  // Group by income vs expense for at-a-glance scanning. Within each group
  // we keep the server's order (start date asc, then name).
  const income = items.filter((i) => i.isIncome)
  const expenses = items.filter((i) => !i.isIncome)

  return (
    <div>
      {income.length > 0 && (
        <Section title="Income">
          {income.map((it) => (
            <ScheduledItemRow
              key={it.id}
              item={it}
              accountName={accountById.get(it.accountId)?.name}
            />
          ))}
        </Section>
      )}
      {expenses.length > 0 && (
        <Section title="Expenses">
          {expenses.map((it) => (
            <ScheduledItemRow
              key={it.id}
              item={it}
              accountName={accountById.get(it.accountId)?.name}
            />
          ))}
        </Section>
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
