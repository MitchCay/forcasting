import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { forecastHorizonSchema, runForecast, todayISO } from 'shared'
import { db } from '../db/client'
import { accounts, goals, scheduledItems } from '../db/schema'
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
})

route.get('/', zValidator('query', querySchema), async (c) => {
  const { id: userId } = getUser(c)
  const { horizon } = c.req.valid('query')

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
  const [scheduledRows, goalRows] =
    accountIds.length === 0
      ? [[], await db.select().from(goals).where(eq(goals.userId, userId))]
      : await Promise.all([
          db
            .select()
            .from(scheduledItems)
            .where(inArray(scheduledItems.accountId, accountIds)),
          db.select().from(goals).where(eq(goals.userId, userId)),
        ])

  // The engine accepts structural input types that only declare the fields
  // it actually reads — the Drizzle row shapes are assignable directly, no
  // casting needed.
  const result = runForecast({
    todayISO: todayISO(),
    horizon,
    accounts: accountRows,
    scheduledItems: scheduledRows,
    goals: goalRows,
  })

  return c.json(result)
})

export const forecastRoute = route
