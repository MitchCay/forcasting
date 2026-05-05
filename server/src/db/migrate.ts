import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

const client = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(client)

console.log('Running migrations…')
await migrate(db, { migrationsFolder: './drizzle' })
console.log('✓ Migrations complete')

await client.end()
