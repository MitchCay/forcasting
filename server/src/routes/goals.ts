import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq } from 'drizzle-orm'
import {
  computeContributionPerOccurrence,
  goalInputSchema,
  goalPatchSchema,
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

// Confirms the given account belongs to the user. Used on every write so a
// user can't link a goal to someone else's account.
async function userOwnsAccount(userId: string, accountId: string) {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1)
  return !!row
}

// Looks up a scheduled item only if it belongs to one of the user's accounts
// AND is an income. Returns null otherwise. The validation funnels through
// here on every create/update where a funding item is referenced.
async function loadOwnedIncomeItem(userId: string, itemId: string) {
  const [row] = await db
    .select({ item: scheduledItems })
    .from(scheduledItems)
    .innerJoin(accounts, eq(accounts.id, scheduledItems.accountId))
    .where(and(eq(scheduledItems.id, itemId), eq(accounts.userId, userId)))
    .limit(1)
  if (!row) return null
  if (!row.item.isIncome) return null
  return row.item
}

// ─── List ───────────────────────────────────────────────────────────────

route.get('/', async (c) => {
  const { id: userId } = getUser(c)
  const rows = await db
    .select()
    .from(goals)
    .where(eq(goals.userId, userId))
    .orderBy(asc(goals.targetDate), asc(goals.name))
  return c.json(rows)
})

// ─── Create ─────────────────────────────────────────────────────────────

route.post('/', zValidator('json', goalInputSchema), async (c) => {
  const { id: userId } = getUser(c)
  const data = c.req.valid('json')
  if (!(await userOwnsAccount(userId, data.targetAccountId))) {
    return c.json({ error: 'Target account not found' }, 404)
  }

  // If the user picked a funding scheduled item, look it up (and verify
  // ownership + income-ness) and compute the per-occurrence contribution.
  let contributionPerOccurrenceCents: number | null = null
  if (data.fundedByScheduledItemId) {
    const item = await loadOwnedIncomeItem(userId, data.fundedByScheduledItemId)
    if (!item) {
      return c.json(
        { error: 'Funding scheduled item not found or is not an income' },
        404,
      )
    }
    contributionPerOccurrenceCents = computeContributionPerOccurrence({
      targetCents: data.targetCents,
      savedCents: data.savedCents ?? 0,
      targetDate: data.targetDate,
      fundingItem: {
        frequency: item.frequency,
        startDate: item.startDate,
        endDate: item.endDate,
      },
    })
  }

  const [row] = await db
    .insert(goals)
    .values({ ...data, userId, contributionPerOccurrenceCents })
    .returning()
  return c.json(row, 201)
})

// ─── Read one ───────────────────────────────────────────────────────────

route.get('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ─── Update ─────────────────────────────────────────────────────────────

route.patch('/:id', zValidator('json', goalPatchSchema), async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const data = c.req.valid('json')

  // Verify ownership of the goal itself first.
  const [existing] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // If switching the source account, verify ownership of the new one too.
  if (
    data.targetAccountId &&
    data.targetAccountId !== existing.targetAccountId
  ) {
    if (!(await userOwnsAccount(userId, data.targetAccountId))) {
      return c.json({ error: 'Target account not found' }, 404)
    }
  }

  // Recompute the locked-in contribution whenever any field that affects the
  // math is part of the patch (target_cents, saved_cents, target_date,
  // funded_by_scheduled_item_id). Anything else (e.g. renaming the goal)
  // leaves the existing contribution untouched.
  const mathFieldChanged =
    data.targetCents !== undefined ||
    data.savedCents !== undefined ||
    data.targetDate !== undefined ||
    data.fundedByScheduledItemId !== undefined

  let contributionPerOccurrenceCents = existing.contributionPerOccurrenceCents
  if (mathFieldChanged) {
    const fundingItemId =
      data.fundedByScheduledItemId !== undefined
        ? data.fundedByScheduledItemId
        : existing.fundedByScheduledItemId

    if (!fundingItemId) {
      contributionPerOccurrenceCents = null
    } else {
      const item = await loadOwnedIncomeItem(userId, fundingItemId)
      if (!item) {
        return c.json(
          { error: 'Funding scheduled item not found or is not an income' },
          404,
        )
      }
      contributionPerOccurrenceCents = computeContributionPerOccurrence({
        targetCents: data.targetCents ?? existing.targetCents,
        savedCents: data.savedCents ?? existing.savedCents,
        targetDate: data.targetDate ?? existing.targetDate,
        fundingItem: {
          frequency: item.frequency,
          startDate: item.startDate,
          endDate: item.endDate,
        },
      })
    }
  }

  const [row] = await db
    .update(goals)
    .set({
      ...data,
      contributionPerOccurrenceCents,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, id))
    .returning()
  return c.json(row)
})

// ─── Delete ─────────────────────────────────────────────────────────────

route.delete('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const result = await db
    .delete(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning({ id: goals.id })
  if (result.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

export const goalsRoute = route
