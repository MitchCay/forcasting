import { useMemo } from 'react'
import { formatUSD, type ForecastResponse, type Goal } from 'shared'
import { useGoals } from '../goals/queries'

// Compact one-row-per-goal panel showing on-track status, projected saved,
// and target vs estimated completion dates. Pulls saved-projection from the
// forecast response (computed by the engine) and the raw goal target/date
// from the goals list.

export function GoalStatus({ forecast }: { forecast: ForecastResponse }) {
  const { data: goals } = useGoals()
  const projectionById = useMemo(() => {
    const m = new Map<
      string,
      ForecastResponse['goalProjections'][number]
    >()
    for (const p of forecast.goalProjections) m.set(p.goalId, p)
    return m
  }, [forecast.goalProjections])

  if (!goals || goals.length === 0) return null

  return (
    <div className="goal-status">
      <h3>Goals</h3>
      <ul className="goal-status__list">
        {goals.map((g) => (
          <GoalRow
            key={g.id}
            goal={g}
            projection={projectionById.get(g.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function GoalRow({
  goal,
  projection,
}: {
  goal: Goal
  projection?: ForecastResponse['goalProjections'][number]
}) {
  // Progress numbers/bar reflect what's saved RIGHT NOW — not where the
  // forecast says we'll be at the end of the horizon. The badge alone uses
  // the projection to telegraph trajectory.
  const saved = goal.savedCents
  const percent = Math.round(
    Math.min(1, saved / Math.max(goal.targetCents, 1)) * 100,
  )
  const isReached = saved >= goal.targetCents
  const onTrack = projection?.onTrack ?? false
  const willComplete =
    (projection?.projectedSavedCents ?? saved) >= goal.targetCents
  const completionDate = projection?.estimatedCompletionDate

  // Badge states: reached now / on track / will-arrive-late / behind / unfunded.
  let statusLabel: string
  let statusClass: string
  if (isReached) {
    statusLabel = 'Reached'
    statusClass = 'goal-status__badge goal-status__badge--ok'
  } else if (onTrack) {
    statusLabel = 'On track'
    statusClass = 'goal-status__badge goal-status__badge--ok'
  } else if (willComplete && completionDate) {
    statusLabel = `Reaches ${completionDate}`
    statusClass = 'goal-status__badge goal-status__badge--warn'
  } else if (goal.fundedByScheduledItemId) {
    statusLabel = 'Behind'
    statusClass = 'goal-status__badge goal-status__badge--bad'
  } else {
    statusLabel = 'Unfunded'
    statusClass = 'goal-status__badge goal-status__badge--muted'
  }

  return (
    <li className="goal-status__row">
      <div className="goal-status__head">
        <span className="goal-status__name">{goal.name}</span>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div className="progress" aria-hidden="true">
        <div
          className={`progress__bar ${isReached ? 'complete' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="goal-status__meta">
        <span>
          {formatUSD(saved)} of {formatUSD(goal.targetCents)} ({percent}%)
        </span>
        <span>Target {goal.targetDate}</span>
      </div>
    </li>
  )
}

// ─── Warnings ───────────────────────────────────────────────────────────

export function ForecastWarnings({ forecast }: { forecast: ForecastResponse }) {
  if (forecast.warnings.length === 0) return null
  return (
    <div className="warnings">
      <h3>Heads up</h3>
      <ul>
        {forecast.warnings.map((w, i) => (
          <li key={i} className={`warning warning--${w.type}`}>
            {w.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
