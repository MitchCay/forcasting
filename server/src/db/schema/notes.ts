import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

// Lightweight notes table — a single home for user-created content that
// doesn't drive the forecast. Each row has a `type` discriminator and a
// JSONB `content` payload whose shape varies per type. Today the only type
// is 'ledger' (a two-column name/amount table); future types (journal,
// checklist, etc.) just add a new variant in the shared discriminated
// union without touching this schema.

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull().default(''),
  content: jsonb('content').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type NoteRow = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
