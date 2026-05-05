import { pgTable, text, uuid, timestamp, integer, boolean } from 'drizzle-orm/pg-core'
import { accountTypeEnum } from './enums'
import { user } from './auth'

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: accountTypeEnum('type').notNull(),
  // Cached current balance — updated when the user enters a balance snapshot
  // or after an import reconciles. Cents (signed) for credit accounts.
  currentBalanceCents: integer('current_balance_cents').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  // Reserved accounts (e.g. goal-earmarked savings) stay off the dashboard's
  // available total and the projected forecast line.
  excludeFromForecast: boolean('exclude_from_forecast').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type AccountRow = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
