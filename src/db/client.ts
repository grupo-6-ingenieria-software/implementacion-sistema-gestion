import "dotenv/config";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";
import { demoQueryLogger } from "../main/demo-trace";

const databaseUrl = process.env.DATABASE_URL ?? "file:./local.db";
const client = createClient({
  url: databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

await client.execute("PRAGMA foreign_keys = ON");

try {
  await client.execute("PRAGMA journal_mode = WAL");
} catch {}

export const db = drizzle(client, { schema, logger: demoQueryLogger });
export type DB = typeof db;
export { client, schema };
