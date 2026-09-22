import {
  addDaysISO,
  occurrencesOf,
  type ForecastAccountInput,
  type ForecastResponse,
  type ForecastGoalInput,
  type ForecastScheduledItemInput,
  type Frequency,
  type SpendingCategoryModel,
  type SpendingModelSummary,
} from './index'

// ─── Empirical spending model ───────────────────────────────────────────
//
// The base forecast only knows about scheduled items. In reality the user
// spends more than that — groceries, gas, the odd big annual bill. This module
// estimates that extra, category-by-category, from the data the user already
// keeps, and produces an "adjusted" balance line that layers it on top.
//
// Design (per the user's steer):
//  • Weekly ledger notes DRIVE the prediction — they're categorized and
//    roughly weekly, so they capture real discretionary habits.
//  • Balance-snapshot history is the SOURCE OF TRUTH sanity check: it can't
//    tell us *what* was spent, but it tells us how fast money really drained,
//    so we gently calibrate the ledger total toward it (ledgers stay dominant).
//  • Categories already covered by a scheduled item are excluded (no double
//    counting rent/subscriptions/insurance that's already modeled).
//  • Per category we use a robust steady rate (the historical average,
//    ignoring rare spikes) and amortize those spikes (a once- or-twice-a-year
//    insurance payment) across the year instead of treating them as weekly. The
//    rate is carried forward flat — no trend extrapolation.

// ── Tunables ─────────────────────────────────────────────────────────────
const LOOKBACK_DEFAULT_DAYS = 183 // ~6 months
const LEDGER_WEIGHT = 0.7 // how much the ledgers drive vs. the calibration
const CAL_MIN = 0.5 // clamp on the balance-history correction ratio
const CAL_MAX = 2.0
const SPIKE_MIN_WEEKS = 6
const LUMPY_AMORT_DAYS = 365 // spread rare one-offs across a year
const MIN_WEEKS_FOR_TREND = 4
const TREND_MAX_WEEKS = 13 // when trend is on, ramp for ~a quarter then hold

// Occurrences per week for each recurring frequency, used to express a
// scheduled item's budgeted amount as a weekly rate. one_time is a single
// event (handled by the base line), so it creates no recurring offset.
const PER_WEEK: Record<Frequency, number> = {
  one_time: 0,
  weekly: 1,
  bi_weekly: 1 / 2,
  semi_monthly: 24 / 52,
  monthly: 12 / 52,
  quarterly: 4 / 52,
  semi_annual: 2 / 52,
  annual: 1 / 52,
}

// ── Structural inputs (plain shapes; the server maps DB rows onto these) ──
export interface LedgerObservation {
  /** ISO date this weekly ledger represents (its creation date works well). */
  date: string
  entries: { category: string | null; amountCents: number }[]
}

export interface SpendingTransaction {
  postedAt: string
  category: string | null
  amountCents: number // signed; negative = expense
}

export interface SpendingSnapshot {
  accountId: string
  balanceCents: number
  recordedAt: string
}

export interface SpendingModelInputs {
  todayISO: string
  accounts: ForecastAccountInput[]
  scheduledItems: ForecastScheduledItemInput[]
  ledger: LedgerObservation[]
  transactions: SpendingTransaction[]
  snapshots: SpendingSnapshot[]
  /** Goals — used only to net out goal-savings transfers during calibration
      (money moved to a reserved account is saved, not spent). */
  goals?: ForecastGoalInput[]
  /** When true, layer a bounded per-category trend on top of the flat level
      (ramps for ~a quarter then holds). Default false = flat. */
  applyTrend?: boolean
  /** Days of history to consider. Default ~6 months. */
  lookbackDays?: number
  /** Categories the user has manually excluded from the prediction (e.g. ones
      funded from a goal, so the goal already budgets them). Case-insensitive. */
  excludeCategories?: string[]
}

// ── Internal per-category model (pre-calibration, cents) ─────────────────
interface CategoryModel {
  category: string
  steadyWeekly: number
  slopePerWeek: number
  lumpyDaily: number
  capWeekly: number
}

export interface SpendingModel {
  categoryModels: CategoryModel[]
  calibrationFactor: number
  calibrationApplied: boolean
  weeksObserved: number
  lookbackStart: string
  excludedCategories: string[]
}

// ── Small date/stat helpers ──────────────────────────────────────────────
const MS_DAY = 86_400_000

function parseISO(s: string): number {
  return new Date(`${s}T00:00:00Z`).getTime()
}
function diffDays(fromISO: string, toISO: string): number {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / MS_DAY)
}
function weekStartISO(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`)
  const dow = d.getUTCDay() // 0 Sun .. 6 Sat
  const back = (dow + 6) % 7 // days since Monday
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}
function normalizeCat(c: string | null | undefined): string {
  const t = (c ?? '').trim()
  return t.length ? t : 'Uncategorized'
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}
function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}
function stdev(xs: number[], m: number): number {
  if (xs.length < 2) return 0
  let v = 0
  for (const x of xs) v += (x - m) * (x - m)
  return Math.sqrt(v / (xs.length - 1))
}
// Median — robust to a short burst of unusually high weeks in a way the mean
// isn't (a recent run of big-spend weeks won't drag the ongoing rate up unless
// it's more than half the window).
function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const a = [...xs].sort((p, q) => p - q)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2
}
// Least-squares slope of y over x = 0..n-1 (per-step change).
function slope(ys: number[]): number {
  const n = ys.length
  if (n < 2) return 0
  const xbar = (n - 1) / 2
  const ybar = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (ys[i]! - ybar)
    den += (i - xbar) * (i - xbar)
  }
  return den === 0 ? 0 : num / den
}
// Per-category projected daily spend (pre-calibration) at a day offset from
// today — the trend rides in via the day offset.
function catDailyRate(cm: CategoryModel, dayOffset: number): number {
  // Level (median) plus, when trend is on, a bounded ramp: slopePerWeek is 0
  // when trend is off, so this stays flat. The ramp holds after ~a quarter.
  const weekOffset = Math.min(dayOffset / 7, TREND_MAX_WEEKS)
  const weekly = clamp(
    cm.steadyWeekly + cm.slopePerWeek * weekOffset,
    0,
    cm.capWeekly,
  )
  return weekly / 7 + cm.lumpyDaily
}

// ── Build the model ──────────────────────────────────────────────────────
export function computeSpendingModel(
  inputs: SpendingModelInputs,
): SpendingModel | null {
  const lookbackDays = inputs.lookbackDays ?? LOOKBACK_DEFAULT_DAYS
  const applyTrend = inputs.applyTrend ?? false
  const today = inputs.todayISO
  const lookbackStart = addDaysISO(today, -lookbackDays)

  // Weekly-equivalent expense a scheduled item already budgets, per category.
  // A ledger category that a scheduled item covers contributes only its EXCESS
  // over that budget ("I actually spend more on groceries than the scheduled
  // line"), so the adjustment never double-counts what the base line carries.
  const scheduledWeeklyByCat = new Map<string, number>()
  for (const it of inputs.scheduledItems) {
    if (it.isIncome) continue
    const c = (it.category ?? '').trim()
    if (!c) continue
    const perWeek = PER_WEEK[it.frequency] ?? 0
    if (perWeek <= 0) continue
    const key = c.toLowerCase()
    scheduledWeeklyByCat.set(
      key,
      (scheduledWeeklyByCat.get(key) ?? 0) + it.amountCents * perWeek,
    )
  }

  // Weekly expense buckets: category -> weekStart -> cents.
  const byCat = new Map<string, Map<string, number>>()
  const observedWeeks = new Set<string>()

  const addExpense = (
    dateISO: string,
    category: string | null,
    amountCents: number,
  ) => {
    if (dateISO < lookbackStart || dateISO > today) return
    if (amountCents >= 0) return // expenses only
    const cents = -amountCents
    const week = weekStartISO(dateISO)
    observedWeeks.add(week)
    const cat = normalizeCat(category)
    let wk = byCat.get(cat)
    if (!wk) {
      wk = new Map()
      byCat.set(cat, wk)
    }
    wk.set(week, (wk.get(week) ?? 0) + cents)
  }

  for (const obs of inputs.ledger) {
    for (const e of obs.entries) addExpense(obs.date, e.category, e.amountCents)
  }
  for (const t of inputs.transactions) {
    addExpense(t.postedAt, t.category, t.amountCents)
  }

  const weeksObserved = observedWeeks.size
  if (weeksObserved === 0) return null
  const weekList = Array.from(observedWeeks).sort()

  const userExcluded = new Set(
    (inputs.excludeCategories ?? []).map((c) => c.trim().toLowerCase()),
  )

  const categoryModels: CategoryModel[] = []
  const excludedCategories: string[] = []

  for (const [cat, wk] of byCat) {
    // User-excluded (e.g. goal-funded) categories are handled elsewhere — the
    // client tracks them, so we just drop them from the discretionary model.
    if (userExcluded.has(cat.toLowerCase())) continue

    // Dense series across every observed week (a tracked week with no entry in
    // this category counts as $0, which correctly lowers the average).
    const series = weekList.map((w) => wk.get(w) ?? 0)
    const m = mean(series)
    const sd = stdev(series, m)
    const threshold = m + 2 * sd

    // Steady rate ignores rare spikes; the spike excess is amortized over a
    // year so a genuinely lumpy annual bill is spread out rather than treated
    // as weekly.
    let steadyWeekly = median(series)
    let lumpyWeekly = 0
    if (series.length >= SPIKE_MIN_WEEKS && sd > 0) {
      const steadyVals = series.filter((v) => v <= threshold)
      const spikeVals = series.filter((v) => v > threshold)
      if (steadyVals.length > 0 && spikeVals.length > 0) {
        steadyWeekly = median(steadyVals)
        const lumpyExcess = spikeVals.reduce((a, v) => a + (v - steadyWeekly), 0)
        lumpyWeekly = (Math.max(0, lumpyExcess) / LUMPY_AMORT_DAYS) * 7
      }
    }

    // The category's full ledger weekly-equivalent (steady + amortized lumps).
    const grossWeekly = steadyWeekly + lumpyWeekly

    // Subtract what a scheduled item already budgets for this category — only
    // spend BEYOND the base line is discretionary. Applied to the WHOLE rate
    // (lumps included) so a scheduled payment the user also logs in the ledger
    // — e.g. a mortgage showing up as a big monthly "Housing" entry — isn't
    // double-counted. If the schedule fully covers it, the category drops out.
    const budgetedWeekly = scheduledWeeklyByCat.get(cat.toLowerCase()) ?? 0
    const netWeekly = Math.max(0, grossWeekly - budgetedWeekly)

    if (netWeekly <= 0) {
      if (budgetedWeekly > 0) excludedCategories.push(cat)
      continue
    }

    // Optional trend: slope of the spike-clamped series, so one outlier can't
    // tilt it. Zero unless the caller turned trend on.
    let slopePerWeek = 0
    if (applyTrend && series.length >= MIN_WEEKS_FOR_TREND) {
      const clamped = series.map((v) => (sd > 0 ? Math.min(v, threshold) : v))
      slopePerWeek = slope(clamped)
    }

    const histMax = series.reduce((a, v) => Math.max(a, v), 0)
    const capWeekly = Math.max(netWeekly * 3, histMax * 1.5, netWeekly, 1)

    categoryModels.push({
      category: cat,
      steadyWeekly: netWeekly,
      slopePerWeek,
      lumpyDaily: 0,
      capWeekly,
    })
  }

  if (categoryModels.length === 0) return null

  const { factor, applied } = calibrate(inputs, categoryModels, lookbackStart)

  return {
    categoryModels,
    calibrationFactor: factor,
    calibrationApplied: applied,
    weeksObserved,
    lookbackStart,
    excludedCategories: excludedCategories.sort((a, b) => a.localeCompare(b)),
  }
}

// Balance-history calibration: compare how fast money REALLY drained (from
// snapshots) against what the schedule alone predicts. The gap is the real
// discretionary burn; we nudge the ledger total toward it, but keep ledgers
// dominant (LEDGER_WEIGHT) and clamp the correction so it stays a sanity check.
function calibrate(
  inputs: SpendingModelInputs,
  categoryModels: CategoryModel[],
  lookbackStart: string,
): { factor: number; applied: boolean } {
  const ledgerPerDay = categoryModels.reduce(
    (s, cm) => s + catDailyRate(cm, 0),
    0,
  )
  if (ledgerPerDay <= 0) return { factor: 1, applied: false }

  const today = inputs.todayISO
  const availableIds = new Set(
    inputs.accounts
      .filter((a) => !a.excludeFromForecast && a.type !== 'credit_card')
      .map((a) => a.id),
  )
  if (availableIds.size === 0) return { factor: 1, applied: false }

  // Realized net change/day from snapshots on available accounts.
  const byAccount = new Map<string, SpendingSnapshot[]>()
  for (const s of inputs.snapshots) {
    if (!availableIds.has(s.accountId)) continue
    if (s.recordedAt < lookbackStart || s.recordedAt > today) continue
    const arr = byAccount.get(s.accountId) ?? []
    arr.push(s)
    byAccount.set(s.accountId, arr)
  }
  let realizedPerDay = 0
  let haveRealized = false
  for (const arr of byAccount.values()) {
    if (arr.length < 2) continue
    arr.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    const first = arr[0]!
    const last = arr[arr.length - 1]!
    const days = diffDays(first.recordedAt, last.recordedAt)
    if (days <= 0) continue
    realizedPerDay += (last.balanceCents - first.balanceCents) / days
    haveRealized = true
  }
  if (!haveRealized) return { factor: 1, applied: false }

  // Scheduled-predicted net/day over the same window on available accounts.
  const windowDays = Math.max(1, diffDays(lookbackStart, today))
  let scheduledNet = 0
  for (const it of inputs.scheduledItems) {
    if (!availableIds.has(it.accountId)) continue
    let count = 0
    for (const _d of occurrencesOf(it, lookbackStart, today)) count++
    scheduledNet += (it.isIncome ? it.amountCents : -it.amountCents) * count
  }
  const scheduledPerDay = scheduledNet / windowDays

  // Goal contributions that move money OUT of available accounts (into a
  // reserved goal account) are savings, not spending — net them out so the
  // calibrator doesn't mistake "moved to savings" for "spent".
  let goalOutflow = 0
  for (const g of inputs.goals ?? []) {
    if (!g.fundedByScheduledItemId || g.contributionPerOccurrenceCents == null) {
      continue
    }
    const item = inputs.scheduledItems.find(
      (it) => it.id === g.fundedByScheduledItemId,
    )
    if (!item) continue
    if (!availableIds.has(item.accountId)) continue // not funded from available
    if (availableIds.has(g.targetAccountId)) continue // stays within available
    let count = 0
    for (const _d of occurrencesOf(item, lookbackStart, today)) count++
    goalOutflow += g.contributionPerOccurrenceCents * count
  }
  const goalOutflowPerDay = goalOutflow / windowDays

  // Extra drain beyond the schedule (and beyond goal savings) = the real
  // discretionary burn per day.
  const truthPerDay = scheduledPerDay - goalOutflowPerDay - realizedPerDay
  const ratio =
    truthPerDay <= 0 ? CAL_MIN : clamp(truthPerDay / ledgerPerDay, CAL_MIN, CAL_MAX)
  const factor = LEDGER_WEIGHT + (1 - LEDGER_WEIGHT) * ratio
  return { factor, applied: true }
}

// ── Attach the adjusted line + per-category cumulative spend to points ────
export function annotateWithSpending(
  response: ForecastResponse,
  model: SpendingModel | null,
  todayISO: string,
): ForecastResponse {
  if (!model) return { ...response, spendingModel: null }
  const points = response.points
  if (points.length === 0) {
    return { ...response, spendingModel: summarize(model) }
  }

  const lastDate = points[points.length - 1]!.date
  const maxDay = Math.max(0, diffDays(todayISO, lastDate))
  const factor = model.calibrationFactor
  const cats = model.categoryModels

  // Precompute cumulative projected spend by day — total and per category —
  // so each (sparse) point is a cheap lookup.
  const cumTotal = new Float64Array(maxDay + 1)
  const cumByCat: Record<string, Float64Array> = {}
  for (const cm of cats) cumByCat[cm.category] = new Float64Array(maxDay + 1)
  for (let day = 1; day <= maxDay; day++) {
    let dayTotal = 0
    for (const cm of cats) {
      const rate = catDailyRate(cm, day) * factor
      const col = cumByCat[cm.category]!
      col[day] = col[day - 1]! + rate
      dayTotal += rate
    }
    cumTotal[day] = cumTotal[day - 1]! + dayTotal
  }

  const newPoints = points.map((p) => {
    const day = clamp(diffDays(todayISO, p.date), 0, maxDay)
    const adjustedByCategory: Record<string, number> = {}
    for (const cm of cats) {
      adjustedByCategory[cm.category] = Math.round(cumByCat[cm.category]![day]!)
    }
    return {
      ...p,
      adjustedAvailableBalanceCents:
        p.availableBalanceCents - Math.round(cumTotal[day]!),
      adjustedByCategory,
    }
  })

  return { ...response, points: newPoints, spendingModel: summarize(model) }
}

function summarize(model: SpendingModel): SpendingModelSummary {
  const f = model.calibrationFactor
  const categories: SpendingCategoryModel[] = model.categoryModels
    .map((cm) => ({
      category: cm.category,
      weeklyCents: Math.round((cm.steadyWeekly + cm.lumpyDaily * 7) * f),
      weeklyTrendCents: Math.round(cm.slopePerWeek * f),
    }))
    .filter((c) => c.weeklyCents > 0)
    .sort((a, b) => b.weeklyCents - a.weeklyCents)
  return {
    categories,
    excludedCategories: model.excludedCategories,
    calibrationFactor: Math.round(f * 100) / 100,
    calibrationApplied: model.calibrationApplied,
    weeksObserved: model.weeksObserved,
    lookbackStart: model.lookbackStart,
  }
}

// Convenience wrapper: build the model from history and annotate a base
// forecast response in one call.
export function withSpendingModel(
  response: ForecastResponse,
  inputs: SpendingModelInputs,
): ForecastResponse {
  const model = computeSpendingModel(inputs)
  return annotateWithSpending(response, model, inputs.todayISO)
}
