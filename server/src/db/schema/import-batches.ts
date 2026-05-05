import { pgTable, uuid, timestamp, text, integer } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { accounts } from './accounts'
import { importSourceEnum } from './enums'

// Audit trail for any bulk ingest (CSV upload, OFX file, future Plaid/SimpleFIN
// pulls). Lets us undo a bad import by deleting the batch (cascades to
// transactions via `transactions.import_batch_id`).
export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, {
    onDelete: 'cascade',
  }),
  source: importSourceEnum('source').notNull(),
  filename: text('filename'),
  rowCount: integer('row_count').notNull().default(0),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  error: text('error'),
})

export type ImportBatchRow = typeof importBatches.$inferSelect
export type NewImportBatch = typeof importBatches.$inferInsert
