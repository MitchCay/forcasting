import { pgTable, uuid, timestamp, integer, text, date } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { accounts } from './accounts'
import { scheduledItems } from './scheduled-items'

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetCents: integer('target_cents').notNull(),
  savedCents: integer('saved_cents').notNull().default(0),
  targetDate: date('target_date').notNull(),
  // The account where saved-up money lives (e.g. an Amex Savings account
  // earmarked for a vacation). Distinct from the *funding* account, which is
  // derived from `funded_by_scheduled_item_id` when set.
  targetAccountId: uuid('target_account_id')
    .notNull()
    .references(() => accounts.id),
  // Optional funding source — a scheduled income whose occurrences advance
  // this goal. ON DELETE SET NULL so removing the income just unfunds the
  // goal rather than deleting it.
  fundedByScheduledItemId: uuid('funded_by_scheduled_item_id').references(
    () => scheduledItems.id,
    { onDelete: 'set null' },
  ),
  // Server-managed: locked in on every create/update where target/saved/
  // date/funded_by changes. Null when no funding item is set.
  contributionPerOccurrenceCents: integer('contribution_per_occurrence_cents'),
  // Nullable on purpose — priority is deferred (see TODO.md). Column exists
  // so we don't need a migration when we wire it up.
  priority: integer('priority'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type GoalRow = typeof goals.$inferSelect
export type NewGoal = typeof goals.$inferInsert
