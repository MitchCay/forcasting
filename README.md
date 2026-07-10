# Forecasting

Personal financial forecasting app — track accounts, scheduled income/expenses,
goals, and project balances forward 1 month to 5 years.

## Stack

- **Server:** Bun + Hono + Drizzle ORM + Better Auth
- **Database:** Postgres (Neon recommended; any Postgres works)
- **Web:** Vite + React + TanStack Router + TanStack Query + React Hook Form + Recharts
- **Shared:** Zod schemas reused on both sides

## Layout

```
forecasting/
├── shared/   # zod schemas + inferred types (imported by server and web)
├── server/   # Hono API + Drizzle schema + Better Auth
└── web/      # Vite + React app
```

## First-time setup

1. Install dependencies (Bun workspaces link `shared` into the other packages):
   ```bash
   bun install
   ```

2. Copy the env template and fill in values:
   ```bash
   cp .env.example .env
   # edit .env: set DATABASE_URL and BETTER_AUTH_SECRET
   ```

   For `BETTER_AUTH_SECRET`: `openssl rand -base64 32`

   For `DATABASE_URL`:
   - **Neon (recommended):** create a free project at neon.tech, copy the
     connection string.
   - **Local Postgres:** `postgres://localhost:5432/forecasting`

3. Generate and apply migrations:
   ```bash
   bun run db:generate   # creates SQL migration files from schema
   bun run db:migrate    # applies them to the database
   ```

   If Better Auth's expected schema drifts from what's in
   `server/src/db/schema/auth.ts`, regenerate it:
   ```bash
   cd server && bunx @better-auth/cli generate
   ```

## Running

Two terminals (recommended for clearer logs):
```bash
bun run dev:server   # http://localhost:3000
bun run dev:web      # http://localhost:5173
```

Or both at once:
```bash
bun run dev
```

The web dev server proxies `/api/*` to the Hono server, so the frontend
talks to `http://localhost:5173/api/...` in dev.

## Typecheck & build

```bash
cd web && bunx tsc -b        # web typecheck (should be 0 errors)
cd web && bun run build      # tsc -b && vite build
```

## What's built

- **Auth** — Better Auth with email/password and passkeys.
- **Accounts** — checking / savings / credit card / cash / investment / loan /
  other, with balance snapshots, an `exclude_from_forecast` ("reserved") flag,
  and credit-card statement modeling (balance, due day, paid-from account).
- **Scheduled items** — recurring or one-time income/expenses driving the
  forecast (weekly through annual, plus semi-monthly).
- **Goals** — target + date, optional deferred start, and optional funding from
  a scheduled income (per-occurrence contribution is locked in on save).
- **Forecast dashboard** — day-by-day projection (1 month–5 years) with an
  available-balance area chart, a faint reserved line (expandable per-account),
  summary tiles, category breakdown pie, and negative-balance / infeasible-goal
  warnings.
- **Notes** — free-form ledger tables (name / category / amount) with per-note
  and combined summary stats and category pies. Don't affect the forecast.

The forecast engine (`shared/src/forecast.ts`) is pure and runs identically on
the server and (potentially) the client. Importers (CSV/OFX/SimpleFIN) are the
main unbuilt area — see `TODO.md` for those and other deferred work.

New to the codebase (including Claude)? Start with `CLAUDE.md`.
