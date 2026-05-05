import { useMemo, useState } from 'react'
import {
  formatUSD,
  frequencyLabels,
  type Account,
  type Goal,
  type ScheduledItem,
} from 'shared'
import { Card } from '../../components/Card'
import { useAccounts } from '../accounts/queries'
import { useScheduledItems } from '../scheduled/queries'
import { useDeleteGoal, useGoals } from './queries'
import { GoalForm } from './GoalForm'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysUntil(targetISO: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${targetISO}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

// Friendly relative phrase: "in 12 days", "Today", "5 days overdue".
function relativeDateLabel(targetISO: string): string {
  const days = daysUntil(targetISO)
  if (days === 0) return 'Today'
  if (days === 1) return 'In 1 day'
  if (days > 0) return `In ${days} days`
  if (days === -1) return '1 day overdue'
  return `${Math.abs(days)} days overdue`
}

export function GoalList() {
  const { data: goals, isLoading, error } = useGoals()
  const { data: accounts } = useAccounts()
  const { data: scheduledItems } = useScheduledItems()

  const accountById = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts ?? []) m.set(a.id, a)
    return m
  }, [accounts])

  const itemById = useMemo(() => {
    const m = new Map<string, ScheduledItem>()
    for (const it of scheduledItems ?? []) m.set(it.id, it)
    return m
  }, [scheduledItems])

  if (isLoading) return <p className="muted">Loading goals…</p>
  if (error) {
    return <div className="error-banner">{(error as Error).message}</div>
  }
  if (!goals || goals.length === 0) {
    return <p className="muted">No goals yet.</p>
  }

  return (
    <div>
      {goals.map((g) => (
        <GoalRow
          key={g.id}
          goal={g}
          targetAccountName={accountById.get(g.targetAccountId)?.name}
          fundingItem={
            g.fundedByScheduledItemId
              ? itemById.get(g.fundedByScheduledItemId)
              : undefined
          }
        />
      ))}
    </div>
  )
}

function GoalRow({
  goal,
  targetAccountName,
  fundingItem,
}: {
  goal: Goal
  targetAccountName?: string
  fundingItem?: ScheduledItem
}) {
  const [editing, setEditing] = useState(false)
  const del = useDeleteGoal()

  const progress =
    goal.targetCents > 0
      ? Math.min(1, goal.savedCents / goal.targetCents)
      : 0
  const percent = Math.round(progress * 100)
  const isComplete = goal.savedCents >= goal.targetCents

  const handleDelete = () => {
    if (confirm(`Delete "${goal.name}"?`)) {
      del.mutate(goal.id)
    }
  }

  return (
    <Card
      title={
        <span>
          {goal.name}{' '}
          <span className="muted">
            · {formatUSD(goal.savedCents)} of {formatUSD(goal.targetCents)}
            {targetAccountName ? ` · ${targetAccountName}` : ''}
          </span>
        </span>
      }
      actions={
        <>
          <span className="amount">{percent}%</span>
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
        <GoalForm goal={goal} onSuccess={() => setEditing(false)} />
      ) : (
        <div>
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`${percent}% saved`}
          >
            <div
              className={`progress__bar ${isComplete ? 'complete' : ''}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="muted" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
            {relativeDateLabel(goal.targetDate)} ({goal.targetDate})
            {isComplete
              ? ' · Goal reached'
              : fundingItem && goal.contributionPerOccurrenceCents !== null
              ? ` · ${formatUSD(goal.contributionPerOccurrenceCents)} per ${frequencyLabels[
                  fundingItem.frequency
                ].toLowerCase()} from ${fundingItem.name}`
              : ''}
          </div>
        </div>
      )}
    </Card>
  )
}
