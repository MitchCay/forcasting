import { z } from 'zod'

// ─── Enums (string-array form so Drizzle's pgEnum can reuse them) ────────

export const accountTypes = [
  'checking',
  'savings',
  'credit_card',
  'cash',
  'investment',
  'loan',
  'other',
] as const
export const accountTypeSchema = z.enum(accountTypes)
export type AccountType = z.infer<typeof accountTypeSchema>

export const frequencies = [
  'one_time',
  'weekly',
  'bi_weekly',
  'semi_monthly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
] as const
export const frequencySchema = z.enum(frequencies)
export type Frequency = z.infer<typeof frequencySchema>

export const importSources = [
  'csv',
  'ofx',
  'manual',
  'balance_snapshot',
] as const
export const importSourceSchema = z.enum(importSources)
export type ImportSource = z.infer<typeof importSourceSchema>

export const forecastHorizons = ['1m', '3m', '1y', '3y', '5y'] as const
export const forecastHorizonSchema = z.enum(forecastHorizons)
export type ForecastHorizon = z.infer<typeof forecastHorizonSchema>

// ─── UI labels ──────────────────────────────────────────────────────────

export const frequencyLabels: Record<Frequency, string> = {
  one_time: 'One-time',
  weekly: 'Weekly',
  bi_weekly: 'Bi-weekly',
  semi_monthly: 'Semi-monthly (1st & 15th)',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
}

export const accountTypeLabels: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  cash: 'Cash',
  investment: 'Investment',
  loan: 'Loan',
  other: 'Other',
}

export const forecastHorizonLabels: Record<ForecastHorizon, string> = {
  '1m': '1 month',
  '3m': '3 months',
  '1y': '1 year',
  '3y': '3 years',
  '5y': '5 years',
}

// ─── Money ──────────────────────────────────────────────────────────────
// Wire format is integer cents. UI converts at the edge.

export const cents = z.number().int()
export const positiveCents = cents.positive()

export const dollarsToCents = (d: number) => Math.round(d * 100)
export const centsToDollars = (c: number) => c / 100

export const formatUSD = (c: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(c / 100)

// ─── Common ─────────────────────────────────────────────────────────────

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

// ─── Account ────────────────────────────────────────────────────────────

// Base shape — kept separate from the input schema so we can build a
// patch schema (omits type, since type is locked after creation) without
// going through ZodEffects (which has no .partial / .omit).
export const accountBaseSchema = z.object({
  name: z.string().min(1).max(100),
  type: accountTypeSchema,
  // For most account types this is signed (negative = overdrawn). For
  // type='credit_card' it stores amount currently owed as a positive number
  // so the statement-payment math stays in plain positive arithmetic.
  currentBalanceCents: cents,
  isActive: z.boolean().default(true),
  // Reserved accounts (e.g. goal-earmarked savings) are kept out of the
  // dashboard's "available" total and the projected line, but still appear on
  // the Accounts page and in the forecast as a faint secondary line.
  excludeFromForecast: z.boolean().default(false),
  // ─── Credit-card statement fields ──────────────────────────────────
  // All three are required when type='credit_card' (validated below) and
  // must be null for any other account type.
  statementBalanceCents: cents.nonnegative().nullable().optional(),
  statementDueDay: z.number().int().min(1).max(31).nullable().optional(),
  statementPaidFromAccountId: z.string().uuid().nullable().optional(),
})

// Cross-field constraints. Used by both the input (full) and patch (partial)
// schemas. For the patch schema, `type` is always undefined, so the CC-
// required checks only fire when the caller explicitly sends statement
// fields — otherwise the existing values stay untouched.
function checkAccountInvariants(
  data: Partial<z.infer<typeof accountBaseSchema>>,
  ctx: z.RefinementCtx,
) {
  const isCC = data.type === 'credit_card'

  if (isCC) {
    // Convention: amount-owed must be non-negative for CCs.
    if (
      data.currentBalanceCents !== undefined &&
      data.currentBalanceCents < 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentBalanceCents'],
        message: 'Amount owed must be ≥ 0',
      })
    }
    if (data.statementBalanceCents == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementBalanceCents'],
        message: 'Required for credit-card accounts',
      })
    }
    if (data.statementDueDay == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementDueDay'],
        message: 'Required for credit-card accounts',
      })
    }
    if (!data.statementPaidFromAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementPaidFromAccountId'],
        message: 'Required for credit-card accounts',
      })
    }
  } else if (data.type !== undefined) {
    // Non-CC: statement fields must be unset.
    if (data.statementBalanceCents != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementBalanceCents'],
        message: 'Only valid for credit-card accounts',
      })
    }
    if (data.statementDueDay != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementDueDay'],
        message: 'Only valid for credit-card accounts',
      })
    }
    if (data.statementPaidFromAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementPaidFromAccountId'],
        message: 'Only valid for credit-card accounts',
      })
    }
  }
}

export const accountInputSchema = accountBaseSchema.superRefine(
  checkAccountInvariants,
)
export type AccountInput = z.infer<typeof accountInputSchema>

// PATCH variant: every field optional AND `type` removed entirely. Account
// type is locked after creation; the server also drops `type` from any
// incoming patch as a defense-in-depth measure.
export const accountPatchSchema = accountBaseSchema
  .omit({ type: true })
  .partial()
  .superRefine(checkAccountInvariants)
export type AccountPatch = z.infer<typeof accountPatchSchema>

export const accountSchema = accountBaseSchema.extend({
  id: z.string().uuid(),
  userId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Row-level: these are nullable in the DB and arrive as null when unset.
  statementBalanceCents: cents.nullable(),
  statementDueDay: z.number().int().nullable(),
  statementPaidFromAccountId: z.string().uuid().nullable(),
})
export type Account = z.infer<typeof accountSchema>

// ─── Balance snapshot ───────────────────────────────────────────────────

export const balanceSnapshotInputSchema = z.object({
  accountId: z.string().uuid(),
  balanceCents: cents,
  recordedAt: isoDate,
  note: z.string().max(500).optional(),
})
export type BalanceSnapshotInput = z.infer<typeof balanceSnapshotInputSchema>

// ─── Scheduled item (the unified form's payload) ────────────────────────
// One-time entries are just frequency='one_time' — the form stays one form.

// The raw object shape — kept separate so we can call `.partial()` on it for
// PATCH. The full input schema layers a cross-field date check on top, which
// converts it to a ZodEffects (ZodEffects has no .partial()).
export const scheduledItemBaseSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1).max(100),
  amountCents: positiveCents, // sign comes from isIncome
  frequency: frequencySchema,
  startDate: isoDate,
  // Nullable so PATCH can explicitly clear an end date (e.g. when changing
  // a recurring item to one-time, or removing an end-of-subscription date).
  endDate: isoDate.nullable().optional(),
  isIncome: z.boolean().default(false),
  category: z.string().max(50).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
})

const endAfterStart = (data: {
  startDate?: string
  endDate?: string | null
}) => !data.endDate || !data.startDate || data.endDate >= data.startDate

export const scheduledItemInputSchema = scheduledItemBaseSchema.refine(
  endAfterStart,
  { message: 'End date must be on or after start date', path: ['endDate'] },
)
export type ScheduledItemInput = z.infer<typeof scheduledItemInputSchema>

// PATCH variant: every field optional, plus the same date-order check (which
// only fires when both dates are present in the patch).
export const scheduledItemPatchSchema = scheduledItemBaseSchema
  .partial()
  .refine(endAfterStart, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })
export type ScheduledItemPatch = z.infer<typeof scheduledItemPatchSchema>

export const scheduledItemSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  name: z.string(),
  amountCents: z.number().int(),
  frequency: frequencySchema,
  startDate: isoDate,
  endDate: isoDate.nullable(),
  isIncome: z.boolean(),
  category: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ScheduledItem = z.infer<typeof scheduledItemSchema>

// ─── Transaction (posted, comes from importers) ─────────────────────────

export const transactionInputSchema = z.object({
  accountId: z.string().uuid(),
  amountCents: cents, // signed: negative = expense, positive = income/credit
  postedAt: isoDate,
  description: z.string(),
  category: z.string().optional(),
  merchantName: z.string().optional(),
  importSource: importSourceSchema,
  externalId: z.string().optional(),
  isPending: z.boolean().default(false),
})
export type TransactionInput = z.infer<typeof transactionInputSchema>

// ─── Goal ───────────────────────────────────────────────────────────────
// `priority` deferred — see TODO.md.

export const goalBaseSchema = z.object({
  name: z.string().min(1).max(100),
  targetCents: positiveCents,
  savedCents: cents.nonnegative().default(0),
  targetDate: isoDate,
  targetAccountId: z.string().uuid(),
  // Optional — when set, the server locks in a per-occurrence contribution
  // amount derived from this scheduled income's frequency. The forecast
  // engine reroutes that amount from the income's account to the goal's
  // targetAccountId on every occurrence.
  fundedByScheduledItemId: z.string().uuid().nullable().optional(),
})

const savedNotOverTarget = (data: {
  savedCents?: number
  targetCents?: number
}) =>
  data.savedCents === undefined ||
  data.targetCents === undefined ||
  data.savedCents <= data.targetCents

export const goalInputSchema = goalBaseSchema.refine(savedNotOverTarget, {
  message: 'Saved cannot exceed target',
  path: ['savedCents'],
})
export type GoalInput = z.infer<typeof goalInputSchema>

// PATCH variant: every field optional, plus the same saved/target check
// (only fires when both numbers are present in the patch).
export const goalPatchSchema = goalBaseSchema.partial().refine(
  savedNotOverTarget,
  { message: 'Saved cannot exceed target', path: ['savedCents'] },
)
export type GoalPatch = z.infer<typeof goalPatchSchema>

export const goalSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  name: z.string(),
  targetCents: z.number().int(),
  savedCents: z.number().int(),
  targetDate: isoDate,
  targetAccountId: z.string().uuid(),
  fundedByScheduledItemId: z.string().uuid().nullable(),
  // Server-managed: locked in on create/edit. Null when no funding item.
  contributionPerOccurrenceCents: z.number().int().nullable(),
  priority: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Goal = z.infer<typeof goalSchema>

// ─── Occurrence math ────────────────────────────────────────────────────
// Pure helpers shared by the server (locks in goal contributions on save)
// and the web UI (previews the same number live in the goal form). Both
// consume the same logic so the preview matches what gets stored.

function parseISODate(s: string): Date {
  // Treat ISO date strings as midnight UTC so timezone shifts don't sneak
  // a day in or out when we add days/months.
  return new Date(`${s}T00:00:00Z`)
}

function isoDateOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDaysUTC(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function addMonthsUTC(d: Date, n: number, targetDay: number): Date {
  const r = new Date(d)
  r.setUTCDate(1) // safe placeholder so setUTCMonth doesn't clamp prematurely
  r.setUTCMonth(r.getUTCMonth() + n)
  // Last day of the resulting month — "day 0 of next month".
  const lastDay = new Date(
    Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0),
  ).getUTCDate()
  r.setUTCDate(Math.min(targetDay, lastDay))
  return r
}

// Yields every occurrence date of `item` within the inclusive window
// [fromISO, toISO], also respecting the item's own start/end dates. The
// generator form lets callers stop early or accumulate cheaply.
export function* occurrencesOf(
  item: { frequency: Frequency; startDate: string; endDate: string | null },
  fromISO: string,
  toISO: string,
): Generator<string, void, unknown> {
  if (toISO < fromISO) return

  const from = parseISODate(fromISO)
  const to = parseISODate(toISO)
  const start = parseISODate(item.startDate)
  const end = item.endDate ? parseISODate(item.endDate) : null

  const lo = start > from ? start : from
  const hi = end && end < to ? end : to
  if (hi < lo) return

  if (item.frequency === 'one_time') {
    if (start >= lo && start <= hi) yield isoDateOf(start)
    return
  }

  if (item.frequency === 'semi_monthly') {
    // 1st and 15th of each month, regardless of the item's start day.
    let cursor = new Date(Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1))
    const stop = new Date(Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), 1))
    while (cursor <= stop) {
      const day1 = new Date(cursor)
      const day15 = new Date(cursor)
      day15.setUTCDate(15)
      if (day1 >= lo && day1 <= hi && day1 >= start) yield isoDateOf(day1)
      if (day15 >= lo && day15 <= hi && day15 >= start) yield isoDateOf(day15)
      cursor = addMonthsUTC(cursor, 1, 1)
    }
    return
  }

  // Periodic frequencies — walk forward from start by the appropriate step,
  // preserving the original day-of-month for monthly+ steps so e.g. a Mar 31
  // start hits Mar 31 / Apr 30 / May 31 / Jun 30 / …
  const targetDay = start.getUTCDate()
  const step = (d: Date): Date => {
    switch (item.frequency) {
      case 'weekly':
        return addDaysUTC(d, 7)
      case 'bi_weekly':
        return addDaysUTC(d, 14)
      case 'monthly':
        return addMonthsUTC(d, 1, targetDay)
      case 'quarterly':
        return addMonthsUTC(d, 3, targetDay)
      case 'semi_annual':
        return addMonthsUTC(d, 6, targetDay)
      case 'annual':
        return addMonthsUTC(d, 12, targetDay)
      default:
        return d
    }
  }

  let cursor = new Date(start)
  // Fast-forward to the first occurrence on or after `lo`.
  while (cursor < lo) cursor = step(cursor)

  while (cursor <= hi) {
    yield isoDateOf(cursor)
    cursor = step(cursor)
  }
}

// Counts how many occurrences of `item` fall in the inclusive window
// [fromISO, toISO]. Uses the same generator as the forecast engine.
export function countOccurrencesBetween(
  item: { frequency: Frequency; startDate: string; endDate: string | null },
  fromISO: string,
  toISO: string,
): number {
  let count = 0
  for (const _date of occurrencesOf(item, fromISO, toISO)) count++
  return count
}

// Adds `days` to an ISO date string and returns a new ISO date.
export function addDaysISO(iso: string, days: number): string {
  return isoDateOf(addDaysUTC(parseISODate(iso), days))
}

// Today as an ISO date — provided as a helper so callers don't need to
// roll their own (and so we use the same UTC slicing the engine does).
export function todayISO(): string {
  return isoDateOf(new Date())
}

// Returns the next occurrence of `item` on or after `fromISO`, or null if
// the item has ended before then.
export function nextOccurrenceOnOrAfter(
  item: { frequency: Frequency; startDate: string; endDate: string | null },
  fromISO: string,
): string | null {
  const from = parseISODate(fromISO)
  const start = parseISODate(item.startDate)
  const end = item.endDate ? parseISODate(item.endDate) : null

  if (item.frequency === 'one_time') {
    if (start < from) return null
    if (end && start > end) return null
    return isoDateOf(start)
  }

  if (item.frequency === 'semi_monthly') {
    let cursor = from > start ? new Date(from) : new Date(start)
    // Walk day-by-day until we land on the 1st or 15th. At most 31 hops.
    for (let i = 0; i < 32; i++) {
      const day = cursor.getUTCDate()
      if ((day === 1 || day === 15) && cursor >= start) {
        if (end && cursor > end) return null
        return isoDateOf(cursor)
      }
      cursor = addDaysUTC(cursor, 1)
    }
    return null
  }

  const targetDay = start.getUTCDate()
  const step = (d: Date): Date => {
    switch (item.frequency) {
      case 'weekly':
        return addDaysUTC(d, 7)
      case 'bi_weekly':
        return addDaysUTC(d, 14)
      case 'monthly':
        return addMonthsUTC(d, 1, targetDay)
      case 'quarterly':
        return addMonthsUTC(d, 3, targetDay)
      case 'semi_annual':
        return addMonthsUTC(d, 6, targetDay)
      case 'annual':
        return addMonthsUTC(d, 12, targetDay)
      default:
        return d
    }
  }

  let cursor = new Date(start)
  while (cursor < from) cursor = step(cursor)
  if (end && cursor > end) return null
  return isoDateOf(cursor)
}

// Computes the per-occurrence contribution that funds a goal by its target
// date, given a funding scheduled income. Returns null when there's no
// funding item, 0 when the goal is already met, or the full remaining
// balance when no occurrences fall within the window (compressed funding —
// goal gets fully paid on the next occurrence after target_date).
export function computeContributionPerOccurrence(input: {
  targetCents: number
  savedCents: number
  targetDate: string
  /** ISO date the contribution is being computed on. Defaults to today. */
  todayISO?: string
  fundingItem: {
    frequency: Frequency
    startDate: string
    endDate: string | null
  }
}): number {
  const remaining = input.targetCents - input.savedCents
  if (remaining <= 0) return 0
  const today = input.todayISO ?? isoDateOf(new Date())
  const occurrences = countOccurrencesBetween(
    input.fundingItem,
    today,
    input.targetDate,
  )
  if (occurrences <= 0) return remaining
  // Round up so the goal is fully funded by the target date even when the
  // remainder doesn't divide evenly. The forecast engine caps at `remaining`
  // on the final occurrence so we don't over-fund.
  return Math.ceil(remaining / occurrences)
}

// ─── Forecast ───────────────────────────────────────────────────────────

export const forecastQuerySchema = z.object({
  horizon: forecastHorizonSchema.default('3m'),
  accountIds: z.array(z.string().uuid()).optional(),
})
export type ForecastQuery = z.infer<typeof forecastQuerySchema>

// One scheduled item that fired on a given day. The tooltip renders these
// so the user can see exactly what's driving the change at a hover point.
export const forecastEventSchema = z.object({
  scheduledItemId: z.string().uuid(),
  name: z.string(),
  amountCents: positiveCents, // always positive; isIncome carries the sign
  isIncome: z.boolean(),
  category: z.string().nullable(),
})
export type ForecastEvent = z.infer<typeof forecastEventSchema>

// A goal contribution diverted from one of the day's income events. Target
// account info is included so the tooltip can roll multiple contributions
// hitting the same savings account into a single per-account total.
export const forecastGoalContributionSchema = z.object({
  goalId: z.string().uuid(),
  goalName: z.string(),
  targetAccountId: z.string().uuid(),
  targetAccountName: z.string(),
  cents: positiveCents,
})
export type ForecastGoalContribution = z.infer<
  typeof forecastGoalContributionSchema
>

// A credit-card statement payment hitting a paying account on its due day.
export const forecastCreditCardPaymentSchema = z.object({
  creditCardAccountId: z.string().uuid(),
  creditCardName: z.string(),
  paidFromAccountId: z.string().uuid(),
  paidFromName: z.string(),
  cents: positiveCents,
})
export type ForecastCreditCardPayment = z.infer<
  typeof forecastCreditCardPaymentSchema
>

export const forecastPointSchema = z.object({
  date: isoDate,
  // Sum of accounts NOT marked excludeFromForecast — this is the "spendable"
  // balance the user thinks of as theirs. Renders as the primary chart line.
  availableBalanceCents: cents,
  // Sum of accounts that ARE marked excludeFromForecast (goal-earmarked
  // savings, etc.). Renders as a faint secondary line.
  reservedBalanceCents: cents,
  // Sum of credit-card account balances on this day (positive = amount owed).
  // Kept separate from available/reserved since CC debt only impacts spendable
  // cash on statement-due days, not continuously.
  creditCardDebtCents: cents,
  byAccount: z.record(z.string().uuid(), cents),
  scheduledIncomeCents: cents,
  scheduledExpensesCents: cents,
  goalContributionsCents: cents,
  // Items that fired on this day, plus any goal contributions diverted from
  // them. All three are empty for the today/end bookend points.
  events: z.array(forecastEventSchema),
  goalContributions: z.array(forecastGoalContributionSchema),
  creditCardPayments: z.array(forecastCreditCardPaymentSchema),
  // True when the available total dipped negative on this day.
  isNegative: z.boolean(),
})
export type ForecastPoint = z.infer<typeof forecastPointSchema>

// Sum of expense scheduled-item occurrences within the forecast horizon,
// bucketed by category. Powers the category pie chart on the dashboard.
export const forecastCategoryBreakdownSchema = z.object({
  category: z.string(),
  totalCents: positiveCents,
  occurrences: z.number().int().nonnegative(),
})
export type ForecastCategoryBreakdown = z.infer<
  typeof forecastCategoryBreakdownSchema
>

export const goalProjectionSchema = z.object({
  goalId: z.string().uuid(),
  // Final saved amount at the horizon (capped at targetCents).
  projectedSavedCents: cents,
  // Whether the goal will reach `targetCents` by `targetDate`.
  onTrack: z.boolean(),
  // Estimated date the goal hits its target, given the locked-in per-
  // occurrence contribution and the funding item's schedule. Null if the
  // goal has no funding source or won't be met within the horizon.
  estimatedCompletionDate: isoDate.nullable(),
})
export type GoalProjection = z.infer<typeof goalProjectionSchema>

export const forecastResponseSchema = z.object({
  horizon: forecastHorizonSchema,
  generatedAt: z.string(),
  points: z.array(forecastPointSchema),
  goalProjections: z.array(goalProjectionSchema),
  // Sorted descending by totalCents.
  categoryBreakdown: z.array(forecastCategoryBreakdownSchema),
  warnings: z.array(
    z.object({
      type: z.enum(['negative_balance', 'goal_infeasible', 'stale_balance']),
      message: z.string(),
      firstDate: isoDate.optional(),
      accountId: z.string().uuid().optional(),
      goalId: z.string().uuid().optional(),
      // For negative_balance: the event that flipped the account from
      // non-negative to negative on `firstDate`. Helps the user pinpoint
      // which transaction to adjust without scrubbing the chart.
      triggeringEventName: z.string().optional(),
      triggeringEventAmountCents: positiveCents.optional(),
      triggeringEventKind: z
        .enum(['expense', 'cc_payment', 'goal_contribution'])
        .optional(),
    }),
  ),
})
export type ForecastResponse = z.infer<typeof forecastResponseSchema>

// ─── Forecast engine ────────────────────────────────────────────────────

export * from './forecast'
