import { pgTable, text, uuid, timestamp, integer, boolean, date, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { accountTypeEnum } from './enums'
import { user } from './auth'

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: accountTypeEnum('type').notNull(),
  // Cached current balance. For most account types this is signed (negative
  // = overdrawn). For type='credit_card' we flip the convention: this stores
  // the amount currently owed as a positive number, so the user's
  // statement-payment math stays in plain positive arithmetic.
  currentBalanceCents: integer('current_balance_cents').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  // Reserved accounts (e.g. goal-earmarked savings) stay off the dashboard's
  // available total and the projected forecast line.
  excludeFromForecast: boolean('exclude_from_forecast').notNull().default(false),
  // ─── Credit card statement fields ──────────────────────────────────
  // All three are required when type='credit_card' (validated in shared
  // input schema), null otherwise. ON DELETE SET NULL on paid_from so
  // deleting the paying account just unbinds the relationship rather than
  // cascading.
  statementBalanceCents: integer('statement_balance_cents'),
  statementDueDay: integer('statement_due_day'),
  statementPaidFromAccountId: uuid('statement_paid_from_account_id').references(
    (): AnyPgColumn => accounts.id,
    { onDelete: 'set null' },
  ),
  // The last date through which we've auto-applied this card's statement
  // payments to its balance + the paying account. Defaults to CURRENT_DATE
  // so existing CC rows don't back-fill on first sync.
  lastStatementAppliedDate: date('last_statement_applied_date').default(
    sql`CURRENT_DATE`,
  ),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type AccountRow = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
