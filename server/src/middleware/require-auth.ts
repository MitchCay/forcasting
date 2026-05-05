import type { Context, MiddlewareHandler } from 'hono'
import { auth } from '../auth'

export type AuthVars = {
  user: { id: string; email: string }
  session: { id: string }
}

// Hono middleware that checks the Better Auth session cookie and attaches
// the user/session to the context. Reject with 401 if not signed in.
export const requireAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (
  c,
  next,
) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('user', { id: session.user.id, email: session.user.email })
  c.set('session', { id: session.session.id })
  await next()
}

export const getUser = (c: Context<{ Variables: AuthVars }>) => c.get('user')
