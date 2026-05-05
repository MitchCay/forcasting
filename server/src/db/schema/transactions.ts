import {
  pgTable, uuid, timestamp, integer, text, date, boolean, index,
} from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { importSourceEnum } from './enums'
import { importBatches } from './import-batches'

// Posted (real, historical) transactions. Populated by importers (CSV, OFX,
// manual entry). Distinct from `scheduled_items` which are user-defined
// expectations about the future.
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // Signed: negative = debit/expense, positive = credit/income.
    amountCents: integer('amount_cents').notNull(),
    postedAt: date('posted_at').notNull(),
    description: text('description').notNull(),
    category: text('category'),
    merchantName: text('merchant_name'),
    importSource: importSourceEnum('import_source').notNull(),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
    // Provider-side ID, used for dedup on re-import.
    externalId: text('external_id'),
    isPending: boolean('is_pending').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byAccountDate: index('tx_account_date_idx').on(t.accountId, t.postedAt),
    byExternalId: index('tx_external_idx').on(t.accountId, t.externalId),
  }),
)

export type TransactionRow = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
