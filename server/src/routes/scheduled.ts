import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, asc, inArray } from 'drizzle-orm'
import {
  scheduledItemInputSchema,
  scheduledItemPatchSchema,
} from 'shared'
import { db } from '../db/client'
import { accounts, scheduledItems } from '../db/schema'
import {
  requireAuth,
  getUser,
  type AuthVars,
} from '../middleware/require-auth'
import { syncUser } from '../sync'

const route = new Hono<{ Variables: AuthVars }>()

route.use('*', requireAuth)

// Confirms the given account belongs to the user. Returns true on success or
// short-circuits with a 403/404 when not.
async function userOwnsAccount(userId: string, accountId: string) {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1)
  return !!row
}

// ─── List ───────────────────────────────────────────────────────────────
// Scheduled items are owned indirectly via their account, so we filter by
// joining (or rather: select-where) on the user's accounts.

route.get('/', async (c) => {
  const { id: userId } = getUser(c)
  await syncUser(userId)
  // Subquery: ids of accounts the user owns. Drizzle's select returns the
  // raw ids which we then use in a WHERE IN.
  const owned = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
  const ids = owned.map((r) => r.id)
  if (ids.length === 0) return c.json([])

  const rows = await db
    .select()
    .from(scheduledItems)
    .where(inArray(scheduledItems.accountId, ids))
    .orderBy(asc(scheduledItems.startDate), asc(scheduledItems.name))
  return c.json(rows)
})

// ─── Create ─────────────────────────────────────────────────────────────

route.post('/', zValidator('json', scheduledItemInputSchema), async (c) => {
  const { id: userId } = getUser(c)
  const data = c.req.valid('json')
  if (!(await userOwnsAccount(userId, data.accountId))) {
    return c.json({ error: 'Account not found' }, 404)
  }
  const [row] = await db.insert(scheduledItems).values(data).returning()
  return c.json(row, 201)
})

// ─── Read one ───────────────────────────────────────────────────────────

route.get('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const row = await loadOwnedItem(userId, id)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ─── Update ─────────────────────────────────────────────────────────────

route.patch(
  '/:id',
  zValidator('json', scheduledItemPatchSchema),
  async (c) => {
    const { id: userId } = getUser(c)
    const id = c.req.param('id')
    const data = c.req.valid('json')

    const existing = await loadOwnedItem(userId, id)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    // If the caller is moving the item to a different account, double-check
    // ownership of the new one too.
    if (data.accountId && data.accountId !== existing.accountId) {
      if (!(await userOwnsAccount(userId, data.accountId))) {
        return c.json({ error: 'Account not found' }, 404)
      }
    }

    const [row] = await db
      .update(scheduledItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scheduledItems.id, id))
      .returning()
    return c.json(row)
  },
)

// ─── Delete ─────────────────────────────────────────────────────────────

route.delete('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const existing = await loadOwnedItem(userId, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.delete(scheduledItems).where(eq(scheduledItems.id, id))
  return c.body(null, 204)
})

// ─── Helpers ────────────────────────────────────────────────────────────

// Load a scheduled item only if it belongs to an account owned by the user.
// Returns null otherwise so the caller can 404.
async function loadOwnedItem(userId: string, id: string) {
  const [row] = await db
    .select({
      item: scheduledItems,
    })
    .from(scheduledItems)
    .innerJoin(accounts, eq(accounts.id, scheduledItems.accountId))
    .where(and(eq(scheduledItems.id, id), eq(accounts.userId, userId)))
    .limit(1)
  return row?.item ?? null
}

export const scheduledRoute = route
