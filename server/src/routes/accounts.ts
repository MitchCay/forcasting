import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, desc } from 'drizzle-orm'
import {
  accountInputSchema,
  accountPatchSchema,
  balanceSnapshotInputSchema,
} from 'shared'
import { db } from '../db/client'
import { accounts, balanceSnapshots } from '../db/schema'
import {
  requireAuth,
  getUser,
  type AuthVars,
} from '../middleware/require-auth'

// Verifies that `paidFromId` belongs to the user and is not itself a credit
// card (and not the same account, when editing). Returns null on success or
// the response body that should be sent on failure.
async function validatePaidFrom(
  userId: string,
  paidFromId: string,
  selfId?: string,
): Promise<{ error: string } | null> {
  if (selfId && paidFromId === selfId) {
    return { error: 'A credit card cannot pay itself' }
  }
  const [row] = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.id, paidFromId), eq(accounts.userId, userId)))
    .limit(1)
  if (!row) return { error: 'Paying account not found' }
  if (row.type === 'credit_card') {
    return { error: 'Paying account cannot be another credit card' }
  }
  return null
}

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

  if (data.statementPaidFromAccountId) {
    const err = await validatePaidFrom(userId, data.statementPaidFromAccountId)
    if (err) return c.json(err, 400)
  }

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
  zValidator('json', accountPatchSchema),
  async (c) => {
    const { id: userId } = getUser(c)
    const id = c.req.param('id')
    const data = c.req.valid('json')

    // Account type is locked after creation. Defense-in-depth — even though
    // accountPatchSchema omits `type` from its shape, drop any stray value
    // before the UPDATE so a malformed client can't change the type.
    delete (data as { type?: unknown }).type

    if (data.statementPaidFromAccountId) {
      const err = await validatePaidFrom(
        userId,
        data.statementPaidFromAccountId,
        id,
      )
      if (err) return c.json(err, 400)
    }

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
