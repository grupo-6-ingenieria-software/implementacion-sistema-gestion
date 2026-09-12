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
  await recoverInterruptedCu43Migration(
    client,
    migrationsFolder,
    migrationFiles,
  );

  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const journalTimestamps = new Map(
    journal.entries.map((entry) => [entry.tag, entry.when]),
  );
  const lastDrizzleMigration = await getLastDrizzleMigrationTimestamp(client);

  for (const file of migrationFiles) {
    const migration = await readFile(join(migrationsFolder, file), "utf8");
    const hash = createHash("sha256").update(migration).digest("hex");
    const { rows } = await client.execute({
      sql: 'SELECT hash FROM "__migrations" WHERE hash = ?',
      args: [hash],
    });

    if (rows.length > 0) {
      continue;
    }

    const migrationTimestamp = journalTimestamps.get(file.slice(0, -4));
    const wasAppliedByDrizzle =
      lastDrizzleMigration !== undefined &&
      migrationTimestamp !== undefined &&
      migrationTimestamp <= lastDrizzleMigration;

    if (!wasAppliedByDrizzle) {
      await client.executeMultiple(migration);
    }

    await recordMigrationHash(client, hash);
  }
}

async function recoverInterruptedCu43Migration(
  client: Client,
  migrationsFolder: string,
  migrationFiles: string[],
): Promise<void> {
  const cu43File = migrationFiles.find(
    (file) => file === "0004_cu43_sale_responsible_snapshot.sql",
  );

  if (!cu43File) {
    return;
  }

  const [ventaExists, pendingVentaExists] = await Promise.all([
    tableExists(client, "venta"),
    tableExists(client, "__new_venta"),
  ]);

  if (ventaExists || !pendingVentaExists) {
    return;
  }

  const tableInfo = await client.execute("PRAGMA table_info(__new_venta)");
  const columns = new Set(tableInfo.rows.map((row) => String(row.name)));
  const requiredColumns = [
    "venta_id",
    "venta_responsable_nombre",
    "venta_responsable_rol",
  ];

  if (!requiredColumns.every((column) => columns.has(column))) {
    throw new Error(
      "Se encontró una migración CU43 incompleta con un esquema inesperado.",
    );
  }

  for (const triggerName of [
    "trg_anulacion_venta_marca_estado",
    "trg_anulacion_venta_solo_completada",
    "trg_detalle_venta_producto_activo",
    "trg_venta_efectivo_flag_coherente",
    "trg_venta_lote_stock_suficiente",
  ]) {
    await client.execute(`DROP TRIGGER IF EXISTS "${triggerName}"`);
  }

  await client.executeMultiple(`
    ALTER TABLE "__new_venta" RENAME TO "venta";
    CREATE INDEX IF NOT EXISTS "idx_venta_fecha" ON "venta" ("venta_fecha_hora");
    CREATE INDEX IF NOT EXISTS "idx_venta_cierre" ON "venta" ("cierre_caja_id");
    CREATE INDEX IF NOT EXISTS "idx_venta_cajero" ON "venta" ("usuario_cajero_id", "venta_fecha_hora");
    CREATE INDEX IF NOT EXISTS "idx_venta_estado" ON "venta" ("venta_estado");
  `);

  const migration = await readFile(join(migrationsFolder, cu43File), "utf8");
  const hash = createHash("sha256").update(migration).digest("hex");
  await recordMigrationHash(client, hash);
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = ?`,
    args: [tableName],
  });
  return result.rows.length > 0;
}

async function recordMigrationHash(client: Client, hash: string): Promise<void> {
  await client.execute({
    sql: `INSERT OR IGNORE INTO "__migrations" (hash, created_at)
          VALUES (?, ?)`,
    args: [hash, Date.now()],
  });
}

async function getLastDrizzleMigrationTimestamp(
  client: Client,
): Promise<number | undefined> {
  const table = await client.execute({
    sql: `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = '__drizzle_migrations'`,
    args: [],
  });

  if (table.rows.length === 0) {
    return undefined;
  }

  const result = await client.execute(
    'SELECT MAX(created_at) AS created_at FROM "__drizzle_migrations"',
  );
  const createdAt = result.rows[0]?.created_at;

  return typeof createdAt === "number" ? createdAt : undefined;
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
