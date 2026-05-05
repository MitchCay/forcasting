import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { db } from './db/client'
import * as schema from './db/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      passkey: schema.passkey,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    passkey({
      // Relying-Party identity. rpID must be the registrable domain (no
      // protocol, no port). For localhost dev that's just 'localhost'.
      rpID: process.env.PASSKEY_RP_ID ?? 'localhost',
      rpName: process.env.PASSKEY_RP_NAME ?? 'Forecasting',
      // Origin must include scheme + host + port and match where the user
      // accesses the app from.
      origin: process.env.PASSKEY_ORIGIN ?? 'http://localhost:5173',
    }),
  ],
  trustedOrigins: ['http://localhost:5173'],
})

export type Auth = typeof auth
