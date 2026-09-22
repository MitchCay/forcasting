import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { forecastHorizonSchema, runForecast, todayISO, withSpendingModel } from 'shared'
import { db } from '../db/client'
import {
  accounts,
  balanceSnapshots,
  goals,
  notes,
  scheduledItems,
  transactions,
  type BalanceSnapshotRow,
  type ScheduledItemRow,
  type TransactionRow,
} from '../db/schema'
import {
  requireAuth,
  getUser,
  type AuthVars,
} from '../middleware/require-auth'
import { syncUser } from '../sync'

const route = new Hono<{ Variables: AuthVars }>()

route.use('*', requireAuth)

// Query schema — `horizon` defaults to '3m' (the user's preferred default).
const querySchema = z.object({
  horizon: forecastHorizonSchema.default('3m'),
  // Comma-separated categories the user has excluded from the prediction
  // (e.g. goal-funded ones). Optional.
  excludeCats: z.string().optional(),
  // '1' to layer a bounded spending trend on the predicted line. Optional.
  trend: z.string().optional(),
})

route.get('/', zValidator('query', querySchema), async (c) => {
  const { id: userId } = getUser(c)
  const { horizon, excludeCats, trend } = c.req.valid('query')
  const excludeCategories = (excludeCats ?? '')
    .split(',')
    .map((c2) => c2.trim())
    .filter((c2) => c2.length > 0)
  const applyTrend = trend === '1' || trend === 'true'

  // Apply any pending past events to the user's data before projecting.
  await syncUser(userId)

  // ── Load the user's data ─────────────────────────────────────────
  // The user's accounts feed both the engine and the scheduled-items
  // filter. We load them once and reuse.
  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))

  const accountIds = accountRows.map((a) => a.id)

  // Load everything the forecast + spending model need in one round-trip.
  // Scheduled items, snapshots and transactions are scoped by the user's
  // account ids; goals + notes are scoped by user id directly.
  const [scheduledRows, goalRows, noteRows, snapshotRows, transactionRows] =
    await Promise.all([
      accountIds.length === 0
        ? Promise.resolve([] as ScheduledItemRow[])
        : db
            .select()
            .from(scheduledItems)
            .where(inArray(scheduledItems.accountId, accountIds)),
      db.select().from(goals).where(eq(goals.userId, userId)),
      db
        .select()
        .from(notes)
        .where(and(eq(notes.userId, userId), eq(notes.type, 'ledger'))),
      accountIds.length === 0
        ? Promise.resolve([] as BalanceSnapshotRow[])
        : db
            .select()
            .from(balanceSnapshots)
            .where(inArray(balanceSnapshots.accountId, accountIds)),
      accountIds.length === 0
        ? Promise.resolve([] as TransactionRow[])
        : db
            .select()
            .from(transactions)
            .where(inArray(transactions.accountId, accountIds)),
    ])

  const now = todayISO()

  // The engine accepts structural input types that only declare the fields
  // it actually reads — the Drizzle row shapes are assignable directly.
  const base = runForecast({
    todayISO: now,
    horizon,
    accounts: accountRows,
    scheduledItems: scheduledRows,
    goals: goalRows,
  })

  // Layer on the empirical (history-driven) adjusted line + per-category
  // breakout. Ledger notes drive it; balance snapshots calibrate it.
  const result = withSpendingModel(base, {
    todayISO: now,
    accounts: accountRows,
    scheduledItems: scheduledRows,
    goals: goalRows,
    excludeCategories,
    applyTrend,
    ledger: noteRows.map((n) => {
      const content = n.content as {
        entries?: { category?: string | null; amountCents: number }[]
      }
      return {
        // A weekly ledger's creation date is a good stand-in for the week it
        // covers (its title is free-form and unreliable to parse).
        date: new Date(n.createdAt).toISOString().slice(0, 10),
        entries: (content.entries ?? []).map((e) => ({
          category: e.category ?? null,
          amountCents: e.amountCents,
        })),
      }
    }),
    transactions: transactionRows.map((t) => ({
      postedAt: t.postedAt,
      category: t.category,
      amountCents: t.amountCents,
    })),
    snapshots: snapshotRows.map((s) => ({
      accountId: s.accountId,
      balanceCents: s.balanceCents,
      recordedAt: s.recordedAt,
    })),
  })

  return c.json(result)
})

export const forecastRoute = route
