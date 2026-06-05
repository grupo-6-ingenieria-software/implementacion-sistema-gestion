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
const script = readFileSync(sqlPath, 'utf-8');

const client = createClient({
  url: process.env.DATABASE_URL ?? 'file:./local.db',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// executeMultiple deja que el parser de SQLite separe sentencias: maneja
// correctamente los cuerpos BEGIN...END de los triggers y los comentarios.
await client.executeMultiple(script);

// Reporte: cuántos triggers quedaron definidos.
const { rows } = await client.execute(
  "SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'",
);
console.log(`✓ Triggers aplicados. Total de triggers en la BD: ${rows[0]!.n}`);
client.close();
