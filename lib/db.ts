// lib/db.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Connection string from your docker-compose
const connectionString = process.env.DATABASE_URL || 'postgres://myuser:mypassword@localhost:5432/adrolls_db';

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client);