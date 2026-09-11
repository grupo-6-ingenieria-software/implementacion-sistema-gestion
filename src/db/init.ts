import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import type { DB } from "./client.js";

export interface DatabaseInitPaths {
  migrationsFolder: string;

  triggersPath: string;
}

export function resolveDatabaseInitPaths(options?: {
  isPackaged?: boolean;
  resourcesPath?: string;
}): DatabaseInitPaths {
  if (options?.isPackaged && options.resourcesPath) {
    return {
      migrationsFolder: join(options.resourcesPath, "drizzle", "migrations"),
      triggersPath: join(options.resourcesPath, "triggers.sql"),
    };
  }

  return {
    migrationsFolder: join(process.cwd(), "drizzle", "migrations"),
    triggersPath: join(process.cwd(), "src", "db", "triggers.sql"),
  };
}

export async function applyTriggers(
  client: Client,
  triggersPath: string,
): Promise<void> {
  const script = await readFile(triggersPath, "utf-8");
  await client.executeMultiple(script);
}

async function applyMigrations(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "__migrations" (
      hash TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const migrationFiles = (await readdir(migrationsFolder))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const migration = await readFile(join(migrationsFolder, file), "utf8");
    const hash = createHash("sha256").update(migration).digest("hex");
    const { rows } = await client.execute({
      sql: 'SELECT hash FROM "__migrations" WHERE hash = ?',
      args: [hash],
    });

    if (rows.length === 0) {
      await client.executeMultiple(migration);
      await client.execute({
        sql: 'INSERT INTO "__migrations" (hash, created_at) VALUES (?, ?)',
        args: [hash, Date.now()],
      });
    }
  }
}

export async function initializeDatabase(
  db: DB,
  client: Client,
  paths: DatabaseInitPaths = resolveDatabaseInitPaths(),
): Promise<void> {
  void db;
  await applyMigrations(client, paths.migrationsFolder);

  await applyTriggers(client, paths.triggersPath);
}
