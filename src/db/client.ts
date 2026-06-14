import 'dotenv/config';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

const databaseUrl = process.env.DATABASE_URL ?? 'file:./local.db';
const client = createClient({
  url: databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// libSQL inicia cada conexión con foreign_keys = OFF.
// Sin esto los REFERENCES ... ON DELETE son decorativos.
await client.execute('PRAGMA foreign_keys = ON');

try {
  await client.execute('PRAGMA journal_mode = WAL');
} catch {
  // Turso remoto no permite cambiar journal_mode; es solo una optimizacion local.
}

export const db = drizzle(client, { schema });
export type DB = typeof db;
export { client, schema };