import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, "..", "triggers.sql");
const script = readFileSync(sqlPath, "utf-8");

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

await client.executeMultiple(script);

const { rows } = await client.execute(
  "SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'",
);
console.log(`✓ Triggers aplicados. Total de triggers en la BD: ${rows[0]!.n}`);
client.close();
