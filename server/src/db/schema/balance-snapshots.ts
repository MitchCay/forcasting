import { pgTable, uuid, timestamp, integer, text, date, index } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

// Manual "this is what my balance is today" entries. The most recent snapshot
// is the canonical starting point for forecasting; transactions and scheduled
// items are applied forward from there.
export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    balanceCents: integer('balance_cents').notNull(),
    recordedAt: date('recorded_at').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byAccountDate: index('snap_account_date_idx').on(t.accountId, t.recordedAt),
  }),
)

export type BalanceSnapshotRow = typeof balanceSnapshots.$inferSelect
export type NewBalanceSnapshot = typeof balanceSnapshots.$inferInsert
