import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  forecastHorizonSchema,
  runForecast,
  todayISO,
  type Account,
  type Goal,
  type ScheduledItem,
} from 'shared'
import { db } from '../db/client'
import { accounts, goals, scheduledItems } from '../db/schema'
import {
  requireAuth,
  getUser,
  type AuthVars,
} from '../middleware/require-auth'

const route = new Hono<{ Variables: AuthVars }>()

route.use('*', requireAuth)

// Query schema — `horizon` defaults to '3m' (the user's preferred default).
const querySchema = z.object({
  horizon: forecastHorizonSchema.default('3m'),
})

route.get('/', zValidator('query', querySchema), async (c) => {
  const { id: userId } = getUser(c)
  const { horizon } = c.req.valid('query')

  // ── Load the user's data ─────────────────────────────────────────
  // Three queries in parallel; they don't depend on each other and the DB
  // round-trips dominate. Scheduled items are filtered by the user's owned
  // accounts (via inArray).
  const [accountRows, scheduledRows, goalRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)),
    db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .then(async (owned) => {
        if (owned.length === 0) return [] as ScheduledItem[]
        const ids = owned.map((a) => a.id)
        return db
          .select()
          .from(scheduledItems)
          .where(inArray(scheduledItems.accountId, ids)) as Promise<
          ScheduledItem[]
        >
      }),
    db.select().from(goals).where(eq(goals.userId, userId)),
  ])

  const result = runForecast({
    todayISO: todayISO(),
    horizon,
    accounts: accountRows as Account[],
    scheduledItems: scheduledRows,
    goals: goalRows as Goal[],
  })

  return c.json(result)
})

export const forecastRoute = route
