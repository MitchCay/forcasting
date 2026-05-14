import {
  pgTable, uuid, timestamp, integer, text, date, boolean, index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { accounts } from './accounts'
import { frequencyEnum } from './enums'

// User-defined expected income/expenses. The unified transaction form writes
// here. One-time entries are just `frequency: 'one_time'` so the form stays
// one form. The forecast engine generates concrete future occurrences from
// these on demand (no materialized future table).
export const scheduledItems = pgTable(
  'scheduled_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Always positive; sign comes from `isIncome`.
    amountCents: integer('amount_cents').notNull(),
    frequency: frequencyEnum('frequency').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    isIncome: boolean('is_income').notNull().default(false),
    category: text('category'),
    notes: text('notes'),
    // The last date through which this item's occurrences have been applied
    // to account balances + goal savedCents. Defaults to CURRENT_DATE so
    // existing rows + freshly-created items don't back-fill historical
    // occurrences on the first sync. Sync advances this to "yesterday" so
    // the forecast engine handles today's events as projections.
    lastAppliedDate: date('last_applied_date').default(sql`CURRENT_DATE`),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    byAccount: index('sched_account_idx').on(t.accountId),
  }),
)

export type ScheduledItemRow = typeof scheduledItems.$inferSelect
export type NewScheduledItem = typeof scheduledItems.$inferInsert
