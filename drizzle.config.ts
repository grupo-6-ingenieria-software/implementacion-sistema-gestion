import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./local.db',
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
  verbose: true,
  strict: true,
});
