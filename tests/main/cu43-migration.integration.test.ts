import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type TestDatabase = Awaited<ReturnType<typeof createLegacyDatabase>>;

const historicalSaleId = "00000000-0000-4000-8000-000000000401";
const fallbackSaleId = "00000000-0000-4000-8000-000000000402";
const cashId = "00000000-0000-4000-8000-000000000201";

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

describe("CU43 migration and sale snapshot integrity", () => {
  it("backfills deterministic historical identities, falls back to current data and preserves children", async () => {
    await seedWorkersUsersAndCash(testDb!.client);
    await testDb!.client.executeMultiple(`
      INSERT INTO usuario_version (
        usuario_version_id, usuario_version_nombre, usuario_version_rol,
        usuario_version_fecha_hora_vigencia_desde,
        usuario_version_fecha_hora_vigencia_hasta, usuario_id
      ) VALUES
        ('00000000-0000-4000-8000-000000000999', 'Versión Cerrada', 'trabajador',
         '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', '12345678-9'),
        ('00000000-0000-4000-8000-000000000001', 'Dueña Histórica', 'dueno',
         '2026-01-01T00:00:00.000Z', NULL, '12345678-9');

      INSERT INTO venta (
        venta_id, venta_fecha_hora, venta_descuento_tipo, venta_metodo_pago,
        venta_estado, es_venta_efectivo, es_venta_electronica,
        usuario_cajero_id, cierre_caja_id
      ) VALUES
        ('${historicalSaleId}', '2026-06-12T12:00:00.000Z', 'ninguno', 'efectivo',
         'completada', 1, 0, '12345678-9', '${cashId}'),
        ('${fallbackSaleId}', '2026-06-12T13:00:00.000Z', 'ninguno', 'debito',
         'completada', 0, 1, '87654321-0', '${cashId}');

      INSERT INTO venta_efectivo (venta_id, venta_efectivo_monto_recibido)
      VALUES ('${historicalSaleId}', 2000);
    `);

    await applyCu43Migration(testDb!.client);

    const sales = await testDb!.client.execute(`
      SELECT venta_id, usuario_cajero_id,
        venta_responsable_nombre, venta_responsable_rol
      FROM venta ORDER BY venta_id
    `);
    expect(sales.rows).toEqual([
      {
        venta_id: historicalSaleId,
        usuario_cajero_id: "12345678-9",
        venta_responsable_nombre: "Dueña Histórica",
        venta_responsable_rol: "dueno",
      },
      {
        venta_id: fallbackSaleId,
        usuario_cajero_id: "87654321-0",
        venta_responsable_nombre: "Luis Actual",
        venta_responsable_rol: "trabajador",
      },
    ]);

    const cashPayment = await testDb!.client.execute(
      "SELECT venta_id, venta_efectivo_monto_recibido FROM venta_efectivo",
    );
    expect(cashPayment.rows).toEqual([
      {
        venta_id: historicalSaleId,
        venta_efectivo_monto_recibido: 2000,
      },
    ]);
    expect((await testDb!.client.execute("PRAGMA foreign_key_check")).rows).toEqual(
      [],
    );

    const indexes = await testDb!.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'venta' ORDER BY name",
    );
    expect(indexes.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "idx_venta_cajero",
        "idx_venta_cierre",
        "idx_venta_estado",
        "idx_venta_fecha",
      ]),
    );
  });

  it("aborts instead of inventing an identity when the applicable version is invalid", async () => {
    await seedWorkersUsersAndCash(testDb!.client);
    await testDb!.client.executeMultiple(`
      INSERT INTO usuario_version (
        usuario_version_id, usuario_version_nombre, usuario_version_rol,
        usuario_version_fecha_hora_vigencia_desde,
        usuario_version_fecha_hora_vigencia_hasta, usuario_id
      ) VALUES (
        '00000000-0000-4000-8000-000000000001', '', 'dueno',
        '2026-01-01T00:00:00.000Z', NULL, '12345678-9'
      );
      INSERT INTO venta (
        venta_id, venta_fecha_hora, venta_descuento_tipo, venta_metodo_pago,
        venta_estado, es_venta_efectivo, es_venta_electronica,
        usuario_cajero_id, cierre_caja_id
      ) VALUES (
        '${historicalSaleId}', '2026-06-12T12:00:00.000Z', 'ninguno', 'debito',
        'completada', 0, 1, '12345678-9', '${cashId}'
      );
    `);

    await expect(applyCu43Migration(testDb!.client)).rejects.toThrow(
      /NOT NULL|responsable|constraint/i,
    );

    const legacySales = await testDb!.client.execute(
      "SELECT venta_id FROM venta",
    );
    expect(legacySales.rows).toEqual([{ venta_id: historicalSaleId }]);
    const columns = await testDb!.client.execute("PRAGMA table_info(venta)");
    expect(columns.rows.map((row) => row.name)).not.toContain(
      "venta_responsable_nombre",
    );
  });

  it("rejects invalid snapshots and makes the responsible fields immutable while allowing annulment state", async () => {
    await seedWorkersUsersAndCash(testDb!.client);
    await applyCu43Migration(testDb!.client);
    await testDb!.client.executeMultiple(
      await readFile(join(process.cwd(), "src/db/triggers.sql"), "utf8"),
    );

    const insert = (nombre: string, rol: string) =>
      testDb!.client.execute({
        sql: `INSERT INTO venta (
          venta_id, venta_fecha_hora, venta_descuento_tipo, venta_metodo_pago,
          venta_estado, es_venta_efectivo, es_venta_electronica,
          usuario_cajero_id, venta_responsable_nombre, venta_responsable_rol,
          cierre_caja_id
        ) VALUES (?, '2026-06-12T12:00:00.000Z', 'ninguno', 'debito',
          'completada', 0, 1, '12345678-9', ?, ?, ?)`,
        args: [historicalSaleId, nombre, rol, cashId],
      });

    await expect(insert("   ", "dueno")).rejects.toThrow();
    await expect(insert("Maria Huascar", "administrador")).rejects.toThrow();
    await insert("Maria Huascar", "dueno");

    for (const statement of [
      "UPDATE venta SET usuario_cajero_id = '87654321-0'",
      "UPDATE venta SET venta_responsable_nombre = 'Nombre Nuevo'",
      "UPDATE venta SET venta_responsable_rol = 'trabajador'",
    ]) {
      await expect(testDb!.client.execute(statement)).rejects.toThrow(
        /inmutable|RF43/i,
      );
    }

    await expect(
      testDb!.client.execute("UPDATE venta SET venta_estado = 'anulada'"),
    ).resolves.toBeDefined();
    const sale = await testDb!.client.execute(`
      SELECT venta_estado, venta_responsable_nombre, venta_responsable_rol
      FROM venta
    `);
    expect(sale.rows).toEqual([
      {
        venta_estado: "anulada",
        venta_responsable_nombre: "Maria Huascar",
        venta_responsable_rol: "dueno",
      },
    ]);
  });
});

async function createLegacyDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-cu43-migration-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of [
    "0000_brave_proteus.sql",
    "0001_user_roles_dueno_trabajador.sql",
  ]) {
    await client.executeMultiple(
      await readFile(join(process.cwd(), "drizzle/migrations", file), "utf8"),
    );
  }
  return { client, dir };
}

async function applyCu43Migration(
  client: ReturnType<typeof createClient>,
): Promise<void> {
  await client.executeMultiple(
    await readFile(
      join(
        process.cwd(),
        "drizzle/migrations/0002_cu43_sale_responsible_snapshot.sql",
      ),
      "utf8",
    ),
  );
}

async function seedWorkersUsersAndCash(
  client: ReturnType<typeof createClient>,
): Promise<void> {
  await client.executeMultiple(`
    INSERT INTO trabajador (
      trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
      trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado
    ) VALUES
      (1, '12345678-9', 'Maria', 'Actual', '987654321', '2024-01-01', 'activo'),
      (2, '87654321-0', 'Luis', 'Actual', '987654322', '2024-01-01', 'activo');
    INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES
      ('12345678-9', 'trabajador', '2026-01-01T00:00:00.000Z', 1),
      ('87654321-0', 'trabajador', '2026-01-01T00:00:00.000Z', 2);
    INSERT INTO cierre_caja (
      cierre_caja_id, cierre_fecha_hora_inicio, cierre_estado
    ) VALUES ('${cashId}', '2026-06-12T08:00:00.000Z', 'abierto');
  `);
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
