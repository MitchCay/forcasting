import {
  addDaysISO,
  occurrencesOf,
  type Account,
  type ForecastEvent,
  type ForecastGoalContribution,
  type ForecastHorizon,
  type ForecastPoint,
  type ForecastResponse,
  type Goal,
  type ScheduledItem,
} from './index'

// ─── Inputs ─────────────────────────────────────────────────────────────

export interface ForecastInputs {
  /** ISO date the forecast is computed from. Defaults to "today" UTC. */
  todayISO: string
  horizon: ForecastHorizon
  accounts: Account[]
  scheduledItems: ScheduledItem[]
  goals: Goal[]
}

// Maps a horizon enum to a day count. We keep this here (rather than in
// shared/index) because it's a presentation-layer choice — the schemas
// just store the enum.
const horizonToDays: Record<ForecastHorizon, number> = {
  '1m': 31,
  '3m': 92,
  '1y': 366,
  '3y': 365 * 3,
  '5y': 365 * 5,
}

// ─── Engine ─────────────────────────────────────────────────────────────
//
// Walks the timeline day-by-day from today through `today + horizon`,
// applying scheduled income/expense events, diverting locked-in goal
// contributions, and emitting a forecast point for every day on which
// something happens (plus the start day and the horizon end day so charts
// have stable bookends).
//
// All math is in cents. Account balances and goal saved amounts mutate as
// we walk; we snapshot them into points along the way.

export function runForecast(inputs: ForecastInputs): ForecastResponse {
  const { todayISO, horizon, accounts, scheduledItems, goals } = inputs
  const endISO = addDaysISO(todayISO, horizonToDays[horizon])

  // ── Initial state ──────────────────────────────────────────────────
  const balances = new Map<string, number>()
  for (const a of accounts) balances.set(a.id, a.currentBalanceCents)

  const goalSaved = new Map<string, number>()
  for (const g of goals) goalSaved.set(g.id, g.savedCents)

  // First date a goal hit its target — null until/unless that happens.
  const goalCompletion = new Map<string, string | null>()
  for (const g of goals) {
    goalCompletion.set(g.id, g.savedCents >= g.targetCents ? todayISO : null)
  }

  // First date each non-reserved account dipped negative — for warnings.
  const firstNegativeDate = new Map<string, string>()

  // ── Group events by date ──────────────────────────────────────────
  // We pre-enumerate so we can sort once and walk in order. For 5-year
  // horizons with weekly/biweekly items this stays well under 1000
  // events for typical users.
  const eventsByDate = new Map<string, ScheduledItem[]>()
  for (const item of scheduledItems) {
    for (const date of occurrencesOf(item, todayISO, endISO)) {
      const arr = eventsByDate.get(date)
      if (arr) arr.push(item)
      else eventsByDate.set(date, [item])
    }
  }

  // Goals indexed by their funding scheduled item, so a single occurrence
  // of an income can fund multiple goals at once.
  const goalsByFundingId = new Map<string, Goal[]>()
  for (const g of goals) {
    if (!g.fundedByScheduledItemId) continue
    const arr = goalsByFundingId.get(g.fundedByScheduledItemId)
    if (arr) arr.push(g)
    else goalsByFundingId.set(g.fundedByScheduledItemId, [g])
  }

  // ── Walk events ────────────────────────────────────────────────────
  const points: ForecastPoint[] = []
  // Aggregated expense totals per category over the whole horizon. Keyed by
  // category string ('Uncategorized' for null/empty), tracking both total
  // cents and an occurrence count.
  const categoryAgg = new Map<string, { totalCents: number; occurrences: number }>()
  // Bookend: the starting balance as of today.
  points.push(snapshotPoint(todayISO, balances, accounts, 0, 0, 0, [], []))

  const eventDates = Array.from(eventsByDate.keys()).sort()
  for (const date of eventDates) {
    let dayIncome = 0
    let dayExpenses = 0
    let dayGoalContribs = 0
    const dayEvents: ForecastEvent[] = []
    const dayGoalContributions: ForecastGoalContribution[] = []

    const items = eventsByDate.get(date)!
    for (const item of items) {
      // Record the underlying scheduled item event regardless of type.
      dayEvents.push({
        scheduledItemId: item.id,
        name: item.name,
        amountCents: item.amountCents,
        isIncome: item.isIncome,
        category: item.category,
      })

      if (item.isIncome) {
        // Income lands in the item's account. Track for the day's totals.
        bump(balances, item.accountId, item.amountCents)
        dayIncome += item.amountCents

        // Then divert any goal contributions tied to this income.
        const fundedGoals = goalsByFundingId.get(item.id) ?? []
        for (const goal of fundedGoals) {
          if (goal.contributionPerOccurrenceCents == null) continue
          const saved = goalSaved.get(goal.id) ?? 0
          const remaining = goal.targetCents - saved
          if (remaining <= 0) continue
          // Cap on the final occurrence so we don't over-fund.
          const contribution = Math.min(
            goal.contributionPerOccurrenceCents,
            remaining,
          )
          // Move from the income's account to the goal's target account.
          bump(balances, item.accountId, -contribution)
          bump(balances, goal.targetAccountId, contribution)
          goalSaved.set(goal.id, saved + contribution)
          dayGoalContribs += contribution
          dayGoalContributions.push({
            goalId: goal.id,
            goalName: goal.name,
            cents: contribution,
          })

          // Mark completion the day saved hits target.
          if (
            goalCompletion.get(goal.id) === null &&
            saved + contribution >= goal.targetCents
          ) {
            goalCompletion.set(goal.id, date)
          }
        }
      } else {
        // Expense draws from the item's account.
        bump(balances, item.accountId, -item.amountCents)
        dayExpenses += item.amountCents

        // Roll into the category breakdown for the pie chart.
        const cat =
          item.category && item.category.trim()
            ? item.category.trim()
            : 'Uncategorized'
        const prev = categoryAgg.get(cat) ?? { totalCents: 0, occurrences: 0 }
        categoryAgg.set(cat, {
          totalCents: prev.totalCents + item.amountCents,
          occurrences: prev.occurrences + 1,
        })
      }
    }

    points.push(
      snapshotPoint(
        date,
        balances,
        accounts,
        dayIncome,
        dayExpenses,
        dayGoalContribs,
        dayEvents,
        dayGoalContributions,
      ),
    )

    // Track first-negative date per non-reserved account (for warnings).
    for (const a of accounts) {
      if (a.excludeFromForecast) continue
      if (firstNegativeDate.has(a.id)) continue
      if ((balances.get(a.id) ?? 0) < 0) firstNegativeDate.set(a.id, date)
    }
  }

  // Bookend: end-of-horizon point so charts always span the full window.
  if (points[points.length - 1]!.date !== endISO) {
    points.push(snapshotPoint(endISO, balances, accounts, 0, 0, 0, [], []))
  }

  // ── Goal projections ──────────────────────────────────────────────
  const goalProjections = goals.map((g) => {
    const projectedSavedCents = Math.min(
      goalSaved.get(g.id) ?? 0,
      g.targetCents,
    )
    const completionDate = goalCompletion.get(g.id) ?? null
    const onTrack =
      completionDate !== null && completionDate <= g.targetDate
    return {
      goalId: g.id,
      projectedSavedCents,
      onTrack,
      estimatedCompletionDate: completionDate,
    }
  })

  // ── Warnings ──────────────────────────────────────────────────────
  const warnings: ForecastResponse['warnings'] = []

  for (const [accountId, date] of firstNegativeDate) {
    const account = accounts.find((a) => a.id === accountId)
    if (!account) continue
    warnings.push({
      type: 'negative_balance',
      message: `${account.name} projected negative on ${date}`,
      firstDate: date,
      accountId,
    })
  }

  for (const proj of goalProjections) {
    if (proj.onTrack) continue
    const goal = goals.find((g) => g.id === proj.goalId)
    if (!goal) continue
    // Only warn for goals that were supposed to hit by horizon end. A goal
    // with a target_date past the horizon is still in flight, not infeasible.
    if (goal.targetDate > endISO) continue
    warnings.push({
      type: 'goal_infeasible',
      message: proj.estimatedCompletionDate
        ? `${goal.name} won't be funded until ${proj.estimatedCompletionDate} (target ${goal.targetDate})`
        : `${goal.name} won't be funded by ${goal.targetDate} on the current schedule`,
      firstDate: goal.targetDate,
      goalId: goal.id,
    })
  }

  // Sorted descending so the pie chart's largest slices come first.
  const categoryBreakdown = Array.from(categoryAgg.entries())
    .map(([category, agg]) => ({
      category,
      totalCents: agg.totalCents,
      occurrences: agg.occurrences,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)

  return {
    horizon,
    generatedAt: new Date().toISOString(),
    points,
    goalProjections,
    categoryBreakdown,
    warnings,
  }
}

// ─── Internals ──────────────────────────────────────────────────────────

function bump(map: Map<string, number>, key: string, delta: number) {
  map.set(key, (map.get(key) ?? 0) + delta)
}

function snapshotPoint(
  date: string,
  balances: Map<string, number>,
  accounts: Account[],
  scheduledIncomeCents: number,
  scheduledExpensesCents: number,
  goalContributionsCents: number,
  events: ForecastEvent[],
  goalContributions: ForecastGoalContribution[],
): ForecastPoint {
  let availableBalanceCents = 0
  let reservedBalanceCents = 0
  const byAccount: Record<string, number> = {}
  for (const a of accounts) {
    const b = balances.get(a.id) ?? 0
    byAccount[a.id] = b
    if (a.excludeFromForecast) reservedBalanceCents += b
    else availableBalanceCents += b
  }
  return {
    date,
    availableBalanceCents,
    reservedBalanceCents,
    byAccount,
    scheduledIncomeCents,
    scheduledExpensesCents,
    goalContributionsCents,
    events,
    goalContributions,
    isNegative: availableBalanceCents < 0,
  }
}
