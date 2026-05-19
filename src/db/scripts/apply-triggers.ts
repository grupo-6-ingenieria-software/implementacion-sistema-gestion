/**
 * Aplica src/db/triggers.sql tras `npm run db:migrate`.
 * Idempotente gracias a `CREATE TRIGGER IF NOT EXISTS`.
 *
 * Uso:
 *   npm run db:migrate && npm run db:triggers
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, '..', 'triggers.sql');
const sql = readFileSync(sqlPath, 'utf-8');

const client = createClient({
  url: process.env.DATABASE_URL ?? 'file:./local.db',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const statements = sql
  .split(/END;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('--'))
  .map((s) => (s.endsWith('END') ? s : `${s}\nEND`));

for (const stmt of statements) {
  await client.execute(stmt);
}

console.log(`✓ ${statements.length} triggers aplicados.`);
client.close();
