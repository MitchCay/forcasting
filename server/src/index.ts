import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { auth } from './auth'
import { accountsRoute } from './routes/accounts'
import { scheduledRoute } from './routes/scheduled'
import { goalsRoute } from './routes/goals'
import { forecastRoute } from './routes/forecast'

const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
)

// ─── Better Auth ─────────────────────────────────────────────────────────
// Mounts /api/auth/* (sign-up, sign-in, session, sign-out, etc.)
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// ─── Health ──────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ─── Domain routes ───────────────────────────────────────────────────────
app.route('/api/accounts', accountsRoute)
app.route('/api/scheduled', scheduledRoute)
app.route('/api/goals', goalsRoute)
app.route('/api/forecast', forecastRoute)
// app.route('/api/import', importRoute)         // Phase 7

const port = Number(process.env.PORT ?? 3000)
console.log(`API listening on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
