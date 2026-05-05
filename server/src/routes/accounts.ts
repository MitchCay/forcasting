import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, desc } from 'drizzle-orm'
import {
  accountInputSchema,
  balanceSnapshotInputSchema,
} from 'shared'
import { db } from '../db/client'
import { accounts, balanceSnapshots } from '../db/schema'
import {
  requireAuth,
  getUser,
  type AuthVars,
} from '../middleware/require-auth'

const route = new Hono<{ Variables: AuthVars }>()

route.use('*', requireAuth)

// ─── Accounts ────────────────────────────────────────────────────────────

route.get('/', async (c) => {
  const { id: userId } = getUser(c)
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(desc(accounts.isActive), desc(accounts.createdAt))
  return c.json(rows)
})

route.post('/', zValidator('json', accountInputSchema), async (c) => {
  const { id: userId } = getUser(c)
  const data = c.req.valid('json')
  const [row] = await db
    .insert(accounts)
    .values({ ...data, userId })
    .returning()
  return c.json(row, 201)
})

route.get('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

route.patch(
  '/:id',
  zValidator('json', accountInputSchema.partial()),
  async (c) => {
    const { id: userId } = getUser(c)
    const id = c.req.param('id')
    const data = c.req.valid('json')
    const [row] = await db
      .update(accounts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
  },
)

route.delete('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const result = await db
    .delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .returning({ id: accounts.id })
  if (result.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

// ─── Balance snapshots (nested) ──────────────────────────────────────────

// Verifies `:id` belongs to the authed user; returns the row or 404 response.
async function loadOwnedAccount(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .limit(1)
  return row ?? null
}

route.get('/:id/snapshots', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const owned = await loadOwnedAccount(userId, id)
  if (!owned) return c.json({ error: 'Not found' }, 404)

  const rows = await db
    .select()
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountId, id))
    .orderBy(desc(balanceSnapshots.recordedAt), desc(balanceSnapshots.createdAt))
  return c.json(rows)
})

route.post(
  '/:id/snapshots',
  zValidator('json', balanceSnapshotInputSchema.omit({ accountId: true })),
  async (c) => {
    const { id: userId } = getUser(c)
    const id = c.req.param('id')
    const owned = await loadOwnedAccount(userId, id)
    if (!owned) return c.json({ error: 'Not found' }, 404)

    const data = c.req.valid('json')

    // Insert the snapshot and update the cached current_balance in one txn
    // so they can't drift if one fails.
    const snap = await db.transaction(async (tx) => {
      const [snap] = await tx
        .insert(balanceSnapshots)
        .values({ ...data, accountId: id })
        .returning()
      await tx
        .update(accounts)
        .set({
          currentBalanceCents: data.balanceCents,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, id))
      return snap
    })

    return c.json(snap, 201)
  },
)

route.delete('/:id/snapshots/:snapshotId', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const snapshotId = c.req.param('snapshotId')
  const owned = await loadOwnedAccount(userId, id)
  if (!owned) return c.json({ error: 'Not found' }, 404)

  const result = await db
    .delete(balanceSnapshots)
    .where(
      and(
        eq(balanceSnapshots.id, snapshotId),
        eq(balanceSnapshots.accountId, id),
      ),
    )
    .returning({ id: balanceSnapshots.id })
  if (result.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

export const accountsRoute = route
