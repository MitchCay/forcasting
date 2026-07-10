# CLAUDE.md

Orientation for AI coding sessions on this repo. Read this first, then get
straight to work. Keep it up to date when structure or conventions change.

## What this is

A personal financial forecasting app. Users track accounts, scheduled
income/expenses, and savings goals; the app projects balances forward (1 month
to 5 years) and charts them. See `README.md` for the user-facing feature list
and setup steps.

## Monorepo layout (Bun workspaces)

```
forecasting/
├── shared/   # zod schemas, inferred types, and the pure forecast engine
├── server/   # Hono API + Drizzle (Postgres) + Better Auth
└── web/      # Vite + React + TanStack Router/Query + React Hook Form + Recharts
```

`shared` is imported as the bare specifier `shared` by both `server` and `web`
(Bun workspace link). Types flow one direction: define a Zod schema in
`shared/src/index.ts`, infer the type, and reuse it on both sides.

## Commands

```bash
bun install                 # from repo root; links workspaces
bun run dev                 # server (:3000) + web (:5173) together
bun run dev:server          # just the API
bun run dev:web             # just the web app
bun run db:generate         # drizzle-kit: SQL migrations from schema
bun run db:migrate          # apply migrations
cd web && bunx tsc -b       # web typecheck — keep this at 0 errors
cd web && bun run build      # tsc -b && vite build
```

Env lives in `.env` at the repo root (`DATABASE_URL`, `BETTER_AUTH_SECRET`).
The web dev server proxies `/api/*` → the Hono server.

## Where things live

- **Data model / validation:** `shared/src/index.ts` — Zod schemas + inferred
  types for accounts, scheduled items, goals, notes, and the forecast
  request/response shapes. Also money helpers (`formatUSD`, `dollarsToCents`)
  and occurrence math (`occurrencesOf`, `computeContributionPerOccurrence`).
- **Forecast engine:** `shared/src/forecast.ts` — `runForecast(inputs)`. Pure,
  cents-based, walks the timeline day by day. This is the heart of the app.
- **Server routes:** `server/src/routes/*.ts` — one Hono router per domain
  (`accounts`, `scheduled`, `goals`, `forecast`, `notes`), mounted under
  `/api/*` in `server/src/index.ts`. All routes require auth via
  `middleware/require-auth.ts`. `server/src/sync.ts` applies past due
  scheduled-item occurrences before each forecast read.
- **DB schema:** `server/src/db/schema/*.ts` (Drizzle). Migrations in
  `server/drizzle/`.
- **Web pages:** `web/src/features/<domain>/` — each has a `queries.ts`
  (TanStack Query hooks over the `api()` fetch wrapper) plus components. Routing
  is defined centrally in `web/src/main.tsx` (TanStack Router, no file-based
  routes).
- **Web shared UI:** `web/src/components/` (`Card`, `Modal`, `Field`,
  `Combobox`, `Switch`, `CategoryPicker`). Global styles: `web/src/styles.css`
  (plain CSS with CSS variables like `--bg`, `--accent`, `--positive`; no
  Tailwind).
- **Fetch wrapper:** `web/src/lib/api.ts` — `api<T>(path, { method, json })`.
  Auth: `web/src/lib/auth-client.ts` (Better Auth).

## Conventions & gotchas

- **Money is integer cents everywhere** on the wire and in the engine. Convert
  to dollars only at the UI edge (`centsToDollars` / `formatUSD`).
- **Dates are ISO `YYYY-MM-DD` strings, treated as UTC midnight.** Use the
  helpers in `shared` (`todayISO`, `addDaysISO`, `parseISODate` internals) so
  timezone drift doesn't add/drop a day.
- **`excludeFromForecast`** on an account = "reserved": kept out of the
  available total and drawn as the faint dashed line on the chart. Credit cards
  are excluded from both available and reserved buckets (tracked separately).
- **Forecast points carry `byAccount`** (per-account cents), which the chart
  uses to break the reserved/available lines out per account. Per-account line
  colors come from `web/src/features/forecast/palette.ts` — reuse it anywhere
  (chart, tiles, tooltip) so a given account is the same color everywhere.
- **Recharts custom tooltip:** pass extra data via the element form
  (`content={<ForecastTooltip extraProp={...} />}`), not a render function —
  recharts clones the element and injects `active`/`payload` at hover, and the
  render-function form fights the types.
- **Goal funding** locks in a per-occurrence contribution on save
  (`computeContributionPerOccurrence`), mirrored live in the goal form preview.
  The same function runs on the server (`routes/goals.ts`) — keep them in sync.
- **Keep `web` at 0 tsc errors.** `bunx tsc -b` before finishing. Note: running
  it writes `*.tsbuildinfo` and compiles `vite.config` to `.js`/`.d.ts`; those
  are build artifacts (safe to ignore/gitignore).
- **Persisted UI prefs** use `localStorage` behind a try/catch (see the notes
  "Totals" toggle in `NotesPage.tsx`).

## Adding a feature end-to-end (typical path)

1. Add/extend the Zod schema + inferred type in `shared/src/index.ts`.
2. If it touches storage: update the Drizzle schema in
   `server/src/db/schema/`, then `bun run db:generate && bun run db:migrate`.
3. Add/extend the Hono route in `server/src/routes/` (validate with the shared
   schema; enforce ownership via the user id).
4. If it affects projections: update `shared/src/forecast.ts`.
5. Web: add query hooks in `features/<domain>/queries.ts`, then the components;
   register a new page route in `web/src/main.tsx` if needed.
6. `cd web && bunx tsc -b` and sanity-check in the browser.

## Deferred work

`TODO.md` is the running backlog (importers, transfers, goal priorities,
statement closing dates, hosting, etc.) and now has a "Done" section
summarizing recently shipped work.
