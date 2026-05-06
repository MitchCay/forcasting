import {
  addDaysISO,
  occurrencesOf,
  type Account,
  type ForecastCreditCardPayment,
  type ForecastEvent,
  type ForecastGoalContribution,
  type ForecastHorizon,
  type ForecastPoint,
  type ForecastResponse,
  type Goal,
  type ScheduledItem,
} from './index'

// ─── Credit-card statement scheduling ───────────────────────────────────
// Helpers that compute monthly statement-due dates, clamping to the last day
// of months that don't have the requested day-of-month (e.g. Feb on a card
// whose due day is 31).

function dueDateInMonth(year: number, month: number, dueDay: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(dueDay, last)
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

function firstDueOnOrAfter(fromISO: string, dueDay: number): string {
  const from = new Date(`${fromISO}T00:00:00Z`)
  let year = from.getUTCFullYear()
  let month = from.getUTCMonth()
  let candidate = dueDateInMonth(year, month, dueDay)
  if (candidate < fromISO) {
    month++
    if (month > 11) {
      month = 0
      year++
    }
    candidate = dueDateInMonth(year, month, dueDay)
  }
  return candidate
}

function nextDueAfter(currentISO: string, dueDay: number): string {
  const cur = new Date(`${currentISO}T00:00:00Z`)
  let year = cur.getUTCFullYear()
  let month = cur.getUTCMonth() + 1
  if (month > 11) {
    month = 0
    year++
  }
  return dueDateInMonth(year, month, dueDay)
}

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

  // First date each non-reserved account dipped negative + the event that
  // pushed it there. We capture the trigger only when an event flips an
  // account from ≥0 to <0, so the warning can name the actual cause rather
  // than just the date.
  const firstNegativeDate = new Map<string, string>()
  type Trigger = {
    name: string
    amountCents: number
    kind: 'expense' | 'cc_payment' | 'goal_contribution'
  }
  const negativeTrigger = new Map<string, Trigger>()

  // Walks every non-reserved, non-CC account; for any that crossed from
  // ≥0 to <0 between `pre` and the current balance, records `trigger`.
  function checkForNegativeTransition(
    pre: Map<string, number>,
    date: string,
    trigger: Trigger,
  ) {
    for (const a of accounts) {
      if (a.excludeFromForecast) continue
      if (a.type === 'credit_card') continue
      if (firstNegativeDate.has(a.id)) continue
      const before = pre.get(a.id) ?? 0
      const after = balances.get(a.id) ?? 0
      if (before >= 0 && after < 0) {
        firstNegativeDate.set(a.id, date)
        negativeTrigger.set(a.id, trigger)
      }
    }
  }

  function snapshotBalances(): Map<string, number> {
    return new Map(balances)
  }

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

  // ── Credit-card statement schedule ─────────────────────────────────
  // For each credit-card account that has full statement info, enumerate
  // monthly statement-due dates within the forecast window. We also track
  // each card's mutating statement_balance separately from currentBalance,
  // so the user's recursive "next statement = remaining balance" rule can
  // be applied at each payment day.
  const ccPaymentsByDate = new Map<string, Account[]>()
  const ccStatement = new Map<string, number>()
  const accountById = new Map<string, Account>()
  for (const a of accounts) accountById.set(a.id, a)

  for (const a of accounts) {
    if (a.type !== 'credit_card') continue
    if (
      a.statementBalanceCents == null ||
      a.statementDueDay == null ||
      !a.statementPaidFromAccountId
    )
      continue
    ccStatement.set(a.id, a.statementBalanceCents)

    let cursor = firstDueOnOrAfter(todayISO, a.statementDueDay)
    while (cursor <= endISO) {
      const arr = ccPaymentsByDate.get(cursor)
      if (arr) arr.push(a)
      else ccPaymentsByDate.set(cursor, [a])
      cursor = nextDueAfter(cursor, a.statementDueDay)
    }
  }

  // ── Walk events ────────────────────────────────────────────────────
  const points: ForecastPoint[] = []
  // Aggregated expense totals per category over the whole horizon. Keyed by
  // category string ('Uncategorized' for null/empty), tracking both total
  // cents and an occurrence count.
  const categoryAgg = new Map<string, { totalCents: number; occurrences: number }>()
  // Bookend: the starting balance as of today.
  points.push(snapshotPoint(todayISO, balances, accounts, 0, 0, 0, [], [], []))

  // Union of dates that have either a scheduled-item event or a CC statement
  // payment, sorted. We process both kinds in the same daily snapshot.
  const allEventDates = new Set<string>()
  for (const d of eventsByDate.keys()) allEventDates.add(d)
  for (const d of ccPaymentsByDate.keys()) allEventDates.add(d)
  const eventDates = Array.from(allEventDates).sort()
  for (const date of eventDates) {
    let dayIncome = 0
    let dayExpenses = 0
    let dayGoalContribs = 0
    const dayEvents: ForecastEvent[] = []
    const dayGoalContributions: ForecastGoalContribution[] = []
    const dayCcPayments: ForecastCreditCardPayment[] = []

    const items = eventsByDate.get(date) ?? []
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
        // Income lands in the item's account — never makes an account go
        // negative on its own, so no transition check needed here.
        bump(balances, item.accountId, item.amountCents)
        dayIncome += item.amountCents

        // Then divert any goal contributions tied to this income. These can
        // push the source account negative if the user under-funded.
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
          const preContribution = snapshotBalances()
          bump(balances, item.accountId, -contribution)
          bump(balances, goal.targetAccountId, contribution)
          goalSaved.set(goal.id, saved + contribution)
          dayGoalContribs += contribution
          dayGoalContributions.push({
            goalId: goal.id,
            goalName: goal.name,
            targetAccountId: goal.targetAccountId,
            targetAccountName:
              accountById.get(goal.targetAccountId)?.name ?? '(account)',
            cents: contribution,
          })
          checkForNegativeTransition(preContribution, date, {
            name: `Goal contribution → ${goal.name}`,
            amountCents: contribution,
            kind: 'goal_contribution',
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
        const preExpense = snapshotBalances()
        bump(balances, item.accountId, -item.amountCents)
        dayExpenses += item.amountCents
        checkForNegativeTransition(preExpense, date, {
          name: item.name,
          amountCents: item.amountCents,
          kind: 'expense',
        })

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

    // ── Credit-card statement payments ───────────────────────────────
    // Apply after scheduled events on the same day so any income posted
    // today is available to pay a same-day statement (which is rare but
    // possible for cards with a paycheck-aligned due date).
    const ccDue = ccPaymentsByDate.get(date) ?? []
    for (const cc of ccDue) {
      const paidFromId = cc.statementPaidFromAccountId!
      const statementCents = ccStatement.get(cc.id) ?? 0
      const accountBalanceBefore = balances.get(cc.id) ?? 0

      const prePayment = snapshotBalances()

      // Cash hit on the paying account.
      bump(balances, paidFromId, -statementCents)

      // Per the user's formula:
      //   new_account_balance   = account_balance - statement_balance
      //   new_statement_balance = account_balance - statement_balance
      // (both clamped at 0 — if the user has overpaid, debt is gone and the
      // next statement will be 0 until they update it).
      const next = Math.max(0, accountBalanceBefore - statementCents)
      balances.set(cc.id, next)
      ccStatement.set(cc.id, next)

      const paidFrom = accountById.get(paidFromId)
      dayCcPayments.push({
        creditCardAccountId: cc.id,
        creditCardName: cc.name,
        paidFromAccountId: paidFromId,
        paidFromName: paidFrom?.name ?? '(account)',
        cents: statementCents,
      })
      checkForNegativeTransition(prePayment, date, {
        name: `${cc.name} statement payment`,
        amountCents: statementCents,
        kind: 'cc_payment',
      })
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
        dayCcPayments,
      ),
    )

    // first-negative tracking is handled inside checkForNegativeTransition,
    // called after each individual event so we can identify the trigger.
  }

  // Bookend: end-of-horizon point so charts always span the full window.
  if (points[points.length - 1]!.date !== endISO) {
    points.push(snapshotPoint(endISO, balances, accounts, 0, 0, 0, [], [], []))
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
    const trigger = negativeTrigger.get(accountId)
    const tail = trigger
      ? ` after ${trigger.name} ($${(trigger.amountCents / 100).toFixed(2)})`
      : ''
    warnings.push({
      type: 'negative_balance',
      message: `${account.name} projected negative on ${date}${tail}`,
      firstDate: date,
      accountId,
      triggeringEventName: trigger?.name,
      triggeringEventAmountCents: trigger?.amountCents,
      triggeringEventKind: trigger?.kind,
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
  creditCardPayments: ForecastCreditCardPayment[],
): ForecastPoint {
  let availableBalanceCents = 0
  let reservedBalanceCents = 0
  let creditCardDebtCents = 0
  const byAccount: Record<string, number> = {}
  for (const a of accounts) {
    const b = balances.get(a.id) ?? 0
    byAccount[a.id] = b
    if (a.type === 'credit_card') {
      // Credit-card balances are tracked separately. They don't affect
      // available cash continuously — only on statement-due days, and the
      // hit there shows up via the paid-from account dropping.
      creditCardDebtCents += b
    } else if (a.excludeFromForecast) {
      reservedBalanceCents += b
    } else {
      availableBalanceCents += b
    }
  }
  return {
    date,
    availableBalanceCents,
    reservedBalanceCents,
    creditCardDebtCents,
    byAccount,
    scheduledIncomeCents,
    scheduledExpensesCents,
    goalContributionsCents,
    events,
    goalContributions,
    creditCardPayments,
    isNegative: availableBalanceCents < 0,
  }
}
