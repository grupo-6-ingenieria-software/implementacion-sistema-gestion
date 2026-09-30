import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTriggers } from "../../src/db/init";

type TestDatabase = Awaited<ReturnType<typeof createLegacyDatabase>>;

const definitivaId = "00000000-0000-4000-8000-000000000501";
const temporalId = "00000000-0000-4000-8000-000000000502";

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createLegacyDatabase();
});

afterEach(async () => {
  if (!testDb) return;
  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe("RF59 migration to the physical password model", () => {
  it("drops the ISA flags, keeps every password and gives each temporal its own id", async () => {
    await testDb!.client.executeMultiple(`
      INSERT INTO trabajador (
        trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
        trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado
      ) VALUES (1, '12345678-9', 'Maria', 'Rojas', '987654321', '2024-01-01', 'activo');
      INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
      VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1);
      INSERT INTO contrasena (
        contrasena_id, contrasena_hash, contrasena_fecha_hora_creacion,
        es_contrasena_temporal, es_contrasena_definitiva, usuario_id,
        generada_por_usuario_id
      ) VALUES
        ('${definitivaId}', 'hash-definitiva', '2026-01-01T00:00:00.000Z', 0, 1,
         '12345678-9', '12345678-9'),
        ('${temporalId}', 'hash-temporal', '2026-01-02T00:00:00.000Z', 1, 0,
         '12345678-9', '12345678-9');
      INSERT INTO contrasena_temporal (
        contrasena_id, contrasena_temporal_fecha_hora_expiracion
      ) VALUES ('${temporalId}', '2026-01-03T00:00:00.000Z');
      CREATE TRIGGER trg_contrasena_temporal_flag_coherente
      BEFORE INSERT ON contrasena_temporal
      FOR EACH ROW
      WHEN (SELECT es_contrasena_temporal FROM contrasena
             WHERE contrasena_id = NEW.contrasena_id) <> 1
      BEGIN
        SELECT RAISE(ABORT, 'flag');
      END;
    `);

    await applyMigration(testDb!.client);

    const contrasenaColumns = await testDb!.client.execute(
      "PRAGMA table_info(contrasena)",
    );
    expect(contrasenaColumns.rows.map((row) => row.name)).toEqual([
      "contrasena_id",
      "contrasena_hash",
      "contrasena_fecha_hora_creacion",
      "usuario_id",
      "generada_por_usuario_id",
    ]);

    const temporalColumns = await testDb!.client.execute(
      "PRAGMA table_info(contrasena_temporal)",
    );
    expect(temporalColumns.rows.map((row) => [row.name, row.pk])).toEqual([
      ["contrasena_temporal_id", 1],
      ["contrasena_temporal_fecha_hora_expiracion", 0],
      ["contrasena_id", 0],
    ]);

    const passwords = await testDb!.client.execute(
      "SELECT contrasena_id, contrasena_hash FROM contrasena ORDER BY contrasena_id",
    );
    expect(passwords.rows.map((row) => [row.contrasena_id, row.contrasena_hash])).toEqual([
      [definitivaId, "hash-definitiva"],
      [temporalId, "hash-temporal"],
    ]);

    const temporales = await testDb!.client.execute(`
      SELECT contrasena_temporal_id, contrasena_id,
        contrasena_temporal_fecha_hora_expiracion
      FROM contrasena_temporal
    `);
    expect(temporales.rows).toHaveLength(1);
    expect(String(temporales.rows[0].contrasena_temporal_id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(temporales.rows[0].contrasena_id).toBe(temporalId);
    expect(temporales.rows[0].contrasena_temporal_fecha_hora_expiracion).toBe(
      "2026-01-03T00:00:00.000Z",
    );

    const legacyTrigger = await testDb!.client.execute(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_contrasena_temporal_flag_coherente'
    `);
    expect(legacyTrigger.rows).toHaveLength(0);

    const foreignKeys = await testDb!.client.execute("PRAGMA foreign_key_check");
    expect(foreignKeys.rows).toHaveLength(0);

    await expect(
      testDb!.client.execute(`
        INSERT INTO contrasena_temporal (
          contrasena_temporal_id, contrasena_temporal_fecha_hora_expiracion,
          contrasena_id
        ) VALUES (
          '00000000-0000-4000-8000-000000000503', '2026-01-04T00:00:00.000Z',
          '${temporalId}'
        )
      `),
    ).rejects.toThrow();

    await expect(
      applyTriggers(
        testDb!.client,
        join(process.cwd(), "src", "db", "triggers.sql"),
      ),
    ).resolves.toBeUndefined();
  });
});

async function createLegacyDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-rf59-migration-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of [
    "0000_brave_proteus.sql",
    "0001_user_roles_dueno_trabajador.sql",
    "0002_supplier_orders.sql",
    "0003_sesion_rol_efectivo.sql",
    "0004_cu43_sale_responsible_snapshot.sql",
  ]) {
    await client.executeMultiple(
      await readFile(join(process.cwd(), "drizzle/migrations", file), "utf8"),
    );
  }
  return { client, dir };
}

async function applyMigration(
  client: ReturnType<typeof createClient>,
): Promise<void> {
  await client.executeMultiple(
    await readFile(
      join(
        process.cwd(),
        "drizzle/migrations/0005_rf59_contrasena_modelo_fisico.sql",
      ),
      "utf8",
    ),
  );
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
