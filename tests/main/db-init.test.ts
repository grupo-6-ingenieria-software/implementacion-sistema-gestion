import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import {
  initializeDatabase,
  resolveDatabaseInitPaths,
} from "../../src/db/init";

type TestDatabase = Awaited<ReturnType<typeof createEmptyDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createEmptyDatabase();
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe("initializeDatabase", () => {
  it("crea el esquema en una BD vacía (las migraciones se aplican)", async () => {
    const before = await tableExists(testDb!.client, "producto");
    expect(before).toBe(false);

    await initializeDatabase(testDb!.db, testDb!.client);

    expect(await tableExists(testDb!.client, "producto")).toBe(true);
    expect(await tableExists(testDb!.client, "venta")).toBe(true);
    expect(await tableExists(testDb!.client, "log_errores_tecnicos")).toBe(
      true,
    );
  });

  it("instala los triggers de integridad y estos disparan", async () => {
    await initializeDatabase(testDb!.db, testDb!.client);

    const triggers = await testDb!.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'trigger'",
    );
    const triggerNames = triggers.rows.map((row) => String(row.name));
    expect(triggerNames).toContain("trg_log_errores_no_update");
    expect(triggerNames).toContain("trg_log_errores_no_delete");

    const id = randomUUID();
    await testDb!.client.execute({
      sql: `INSERT INTO log_errores_tecnicos
              (log_errortecnicos_id, log_errores_tipo_error,
               log_errores_modulo, log_errores_descripcion_tecnica, usuario_id)
            VALUES (?, 'error', 'test', 'descripcion', NULL)`,
      args: [id],
    });

    await expect(
      testDb!.client.execute({
        sql: `UPDATE log_errores_tecnicos
                SET log_errores_modulo = 'otro' WHERE log_errortecnicos_id = ?`,
        args: [id],
      }),
    ).rejects.toThrow(/inmutable|RNF10|UPDATE no permitido/i);

    await expect(
      testDb!.client.execute({
        sql: `DELETE FROM log_errores_tecnicos WHERE log_errortecnicos_id = ?`,
        args: [id],
      }),
    ).rejects.toThrow(/inmutable|RNF10|DELETE no permitido/i);
  });

  it("es idempotente: ejecutarla dos veces no falla", async () => {
    await initializeDatabase(testDb!.db, testDb!.client);
    await expect(
      initializeDatabase(testDb!.db, testDb!.client),
    ).resolves.toBeUndefined();

    expect(await tableExists(testDb!.client, "producto")).toBe(true);
  });

  it("reconcilia drizzle-kit y recupera una CU43 interrumpida", async () => {
    const paths = resolveDatabaseInitPaths({ isPackaged: false });

    for (const file of [
      "0000_brave_proteus.sql",
      "0001_user_roles_dueno_trabajador.sql",
      "0002_supplier_orders.sql",
      "0003_sesion_rol_efectivo.sql",
    ]) {
      await testDb!.client.executeMultiple(
        await readFile(join(paths.migrationsFolder, file), "utf8"),
      );
    }

    const journal = JSON.parse(
      await readFile(
        join(paths.migrationsFolder, "meta", "_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ tag: string; when: number }> };
    const appliedAt = journal.entries.find(
      (entry) => entry.tag === "0003_sesion_rol_efectivo",
    )!.when;

    await testDb!.client.execute(`
      CREATE TABLE "__drizzle_migrations" (
        id INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )
    `);
    await testDb!.client.execute({
      sql: `INSERT INTO "__drizzle_migrations" (hash, created_at)
            VALUES (?, ?)`,
      args: ["applied-by-drizzle-kit", appliedAt],
    });
    await testDb!.client.executeMultiple(
      await readFile(paths.triggersPath, "utf8"),
    );

    const cu43 = await readFile(
      join(
        paths.migrationsFolder,
        "0004_cu43_sale_responsible_snapshot.sql",
      ),
      "utf8",
    );
    const renameStatement =
      "ALTER TABLE `__new_venta` RENAME TO `venta`;";
    await testDb!.client.executeMultiple(
      cu43.slice(0, cu43.indexOf(renameStatement)),
    );
    await testDb!.client.execute("PRAGMA foreign_keys = ON");

    expect(await tableExists(testDb!.client, "venta")).toBe(false);
    expect(await tableExists(testDb!.client, "__new_venta")).toBe(true);

    await expect(
      initializeDatabase(testDb!.db, testDb!.client, paths),
    ).resolves.toBeUndefined();

    const ventaColumns = await testDb!.client.execute("PRAGMA table_info(venta)");
    expect(ventaColumns.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "venta_responsable_nombre",
        "venta_responsable_rol",
      ]),
    );
    expect(await tableExists(testDb!.client, "__new_venta")).toBe(false);
    const restoredTriggers = await testDb!.client.execute(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'trg_venta_efectivo_flag_coherente',
        'trg_anulacion_venta_solo_completada',
        'trg_anulacion_venta_marca_estado'
      )
      ORDER BY name
    `);
    expect(restoredTriggers.rows.map((row) => row.name)).toEqual([
      "trg_anulacion_venta_marca_estado",
      "trg_anulacion_venta_solo_completada",
      "trg_venta_efectivo_flag_coherente",
    ]);
    expect(
      Number(
        (
          await testDb!.client.execute(
            'SELECT COUNT(*) AS count FROM "__migrations"',
          )
        ).rows[0]?.count,
      ),
    ).toBe(5);
  });
});

describe("resolveDatabaseInitPaths", () => {
  it("usa rutas del repo en desarrollo", () => {
    const paths = resolveDatabaseInitPaths({ isPackaged: false });
    expect(paths.migrationsFolder).toContain(join("drizzle", "migrations"));
    expect(paths.triggersPath).toContain(join("src", "db", "triggers.sql"));
  });

  it("usa process.resourcesPath cuando está empaquetada", () => {
    const paths = resolveDatabaseInitPaths({
      isPackaged: true,
      resourcesPath: "/opt/app/resources",
    });
    expect(paths.migrationsFolder).toBe(
      join("/opt/app/resources", "drizzle", "migrations"),
    );
    expect(paths.triggersPath).toBe(join("/opt/app/resources", "triggers.sql"));
  });
});

async function createEmptyDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-init-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute("PRAGMA foreign_keys = ON");

  return { client, db, dir };
}

async function tableExists(
  client: ReturnType<typeof createClient>,
  table: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return result.rows.length > 0;
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
