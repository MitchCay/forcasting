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

## What's built (and what isn't)

This is the Phase 1 scaffold. The data model, auth, and project structure
are in place. Routes and UI for each domain (accounts, scheduled items,
goals, forecast, importers) get built out next.

See `TODO.md` for things deliberately deferred.
