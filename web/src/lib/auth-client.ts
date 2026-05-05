import { createAuthClient } from 'better-auth/react'
import { passkeyClient } from '@better-auth/passkey/client'

// Better Auth requires a full URL. Using the current origin keeps everything
// same-origin in dev (Vite proxies /api to the Hono server on :3000), which
// avoids CORS-with-cookies headaches.
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [passkeyClient()],
})

export const { useSession, signIn, signUp, signOut } = authClient
export type AppSession = ReturnType<typeof useSession>['data']
