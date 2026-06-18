import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq } from 'drizzle-orm'
import { noteInputSchema } from 'shared'
import { db } from '../db/client'
import { notes } from '../db/schema'
import {
  requireAuth,
  getUser,
  type AuthVars,
} from '../middleware/require-auth'

const route = new Hono<{ Variables: AuthVars }>()

route.use('*', requireAuth)

// ─── List ───────────────────────────────────────────────────────────────

route.get('/', async (c) => {
  const { id: userId } = getUser(c)
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.createdAt))
  return c.json(rows)
})

// ─── Create ─────────────────────────────────────────────────────────────

route.post('/', zValidator('json', noteInputSchema), async (c) => {
  const { id: userId } = getUser(c)
  const data = c.req.valid('json')
  const [row] = await db.insert(notes).values({ ...data, userId }).returning()
  return c.json(row, 201)
})

// ─── Read one ───────────────────────────────────────────────────────────

route.get('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ─── Update ─────────────────────────────────────────────────────────────
// `type` is locked after creation (a ledger note can't become a checklist
// mid-flight). Edits are limited to title + content; the patch schema uses
// the full input shape sans `type`.

route.patch(
  '/:id',
  zValidator('json', noteInputSchema),
  async (c) => {
    const { id: userId } = getUser(c)
    const id = c.req.param('id')
    const data = c.req.valid('json')

    const [existing] = await db
      .select({ type: notes.type })
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.type !== data.type) {
      return c.json({ error: 'Note type cannot be changed' }, 400)
    }

    const [row] = await db
      .update(notes)
      .set({
        title: data.title,
        content: data.content,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, id))
      .returning()
    return c.json(row)
  },
)

// ─── Delete ─────────────────────────────────────────────────────────────

route.delete('/:id', async (c) => {
  const { id: userId } = getUser(c)
  const id = c.req.param('id')
  const result = await db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning({ id: notes.id })
  if (result.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

export const notesRoute = route
