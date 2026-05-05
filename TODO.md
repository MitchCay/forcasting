# TODO

Things deferred — captured here so we don't lose them.

## Paycheck splitter UX
A single form that lets you say "$5000 paycheck → $3000 Checking, $1500
Savings, $500 Vacation goal" and emits the correct sibling scheduled items +
goal-funding link in one shot. Today the user creates the rows manually.
Schema is already flexible enough; this is a UI helper on top of the existing
`scheduled_items` + `goals.funded_by_scheduled_item_id` model.

## Generic transfers between accounts
Add `transfer_to_account_id` (nullable FK → accounts) on `scheduled_items`.
Forecast engine treats each occurrence as a paired flow: −amount on
`account_id`, +amount on `transfer_to_account_id`, same date. Useful for
non-goal recurring transfers like "$300/mo Checking → Savings."

## Manual goal contribution amount
Currently the per-occurrence contribution is back-computed from
target/saved/date. Could allow an explicit override ("$200/mo no matter what")
for goals where the user wants a fixed savings rate rather than a deadline.

## Per-account reserved amount
The current `accounts.exclude_from_forecast` is binary — the whole account is
either in or out of the dashboard total. If finer control becomes useful, add
`reserved_cents` and have the dashboard subtract that from the available
total instead of hiding the account.

## Goal priorities
Goals currently have no priority. The `goals.priority` column exists (nullable)
for forward-compat. When implementing: rank goals; when projected income is
insufficient to fund all required contributions, flag which goals become
infeasible and by how much. Likely also want a per-pay-period contribution
override per goal.

## Custom interval frequency
Add a "Custom" option to scheduled item frequency: every N days/weeks/months.
Requires extending the `frequency` enum (or splitting frequency + interval into
two columns) and updating the unified transaction form to surface the interval
input when "Custom" is selected.

## Semi-monthly day customization
Currently semi-monthly is hardcoded to 1st and 15th. Some pay schedules use
15th and last-day-of-month. Add two `dayOfMonth` columns or a `pattern` enum.

## OFX / QFX importer
After CSV import is solid, add OFX importer (`server/src/importers/ofx.ts`).
Lake Elmo Bank likely supports OFX Direct Connect via Quicken — if so, pull
transactions automatically rather than requiring manual download.

## SimpleFIN adapter
~$1.50/month alternative to Plaid. Implement as an importer that polls
SimpleFIN's API on a schedule. Webhook support if/when we have a public host.

## Hosting plan
Currently localhost-only. If/when we deploy: Fly.io or Railway, with Neon for
the DB. Need to handle Better Auth secrets, CORS for non-localhost origins,
and a public webhook endpoint if we add SimpleFIN/Plaid.

## Multi-currency
Single currency (USD) assumed. If needed: add `currency` column to accounts
and FX-rate handling to the forecast engine.

## Transaction categorization rules
"Always categorize merchant X as Y" rules to backfill imported transactions.
Probably a `categorization_rules` table keyed on merchant_name regex.

## Reconciliation view
Compare (last balance snapshot + transactions since) vs the cached
`accounts.current_balance_cents`. Surface drift so the user knows when to
update a balance snapshot.

## Forecast confidence band
Currently the forecast is a single deterministic line. Could compute a band
based on historical variance of expense categories. Skip until basics work.
