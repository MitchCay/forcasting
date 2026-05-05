import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

// drizzle-kit doesn't go through Bun's --env-file flag, so we load the root
// .env explicitly here.
config({ path: '../.env' })

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (set it in the root .env)')
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  casing: 'snake_case',
})
