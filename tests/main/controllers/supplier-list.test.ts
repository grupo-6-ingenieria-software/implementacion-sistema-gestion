import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import {
  createSupplierQueryController,
  listSuppliersWithExecutor,
} from "../../../src/main/controllers/supplier-query";
import type { SupplierListRequest } from "../../../src/shared/suppliers";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
let testDb: TestDatabase | undefined;

describe("CU15 supplier list persistence", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await seedFixture(testDb.db);
  });

  afterEach(async () => {
    if (!testDb) return;
    testDb.client.close();
    await removeTempDir(testDb.dir);
    testDb = undefined;
  });

  it.each(["11111111-1", "12345670-K"])(
    "allows the active owner/worker account %s",
    async (usuarioId) => {
      const response = await list({ usuarioId });
      expect(response.suppliers).toHaveLength(3);
    },
  );

  it("returns every field, multiple sorted categories and the complete catalog", async () => {
    const response = await list({ usuarioId: "11111111-1" });

    expect(response.categories).toEqual([
      { id: 2, nombre: "Abarrotes" },
      { id: 3, nombre: "Bebidas" },
      { id: 1, nombre: "Lácteos" },
    ]);
    expect(response.suppliers.map(({ nombreRazonSocial }) => nombreRazonSocial)).toEqual([
      "Ábaco heredado",
      "comercial Norte",
      "Distribuidora Álamo",
    ]);
    expect(response.suppliers[2]).toEqual({
      proveedorId: 1,
      rut: "12.345.678-5",
      nombreRazonSocial: "Distribuidora Álamo",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "ventas@alamo.cl",
      categorias: [
        { id: 2, nombre: "Abarrotes" },
        { id: 1, nombre: "Lácteos" },
      ],
    });
    expect(response.suppliers[0].categorias).toEqual([]);

    const auditRows = await testDb!.db.all<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM log_auditoria
    `);
    expect(Number(auditRows[0].total)).toBe(0);
  });

  it("searches partial names without case or accents and formatted RUTs", async () => {
    const byName = await list({
      busqueda: "  DISTRIBUIDORA   alamo ",
      usuarioId: "11111111-1",
    });
    const byRut = await list({
      busqueda: "12 345 678 5",
      usuarioId: "11111111-1",
    });

    expect(byName.suppliers.map(({ proveedorId }) => proveedorId)).toEqual([1]);
    expect(byRut.suppliers.map(({ proveedorId }) => proveedorId)).toEqual([1]);
  });

  it("filters by category and combines search and category with AND", async () => {
    const byCategory = await list({
      categoriaId: 2,
      usuarioId: "11111111-1",
    });
    expect(byCategory.suppliers.map(({ proveedorId }) => proveedorId)).toEqual([
      2,
      1,
    ]);

    const combinedMatch = await list({
      busqueda: "norte",
      categoriaId: 2,
      usuarioId: "11111111-1",
    });
    expect(combinedMatch.suppliers.map(({ proveedorId }) => proveedorId)).toEqual([
      2,
    ]);

    const combinedMiss = await list({
      busqueda: "norte",
      categoriaId: 1,
      usuarioId: "11111111-1",
    });
    expect(combinedMiss.suppliers).toEqual([]);
  });

  it("returns an empty list for a category without suppliers and keeps the catalog", async () => {
    const response = await list({
      categoriaId: 3,
      usuarioId: "11111111-1",
    });

    expect(response.suppliers).toEqual([]);
    expect(response.categories.map(({ id }) => id)).toEqual([2, 3, 1]);
  });

  it("includes a legacy supplier only without a category filter", async () => {
    const all = await list({ usuarioId: "11111111-1" });
    const filtered = await list({
      categoriaId: 1,
      usuarioId: "11111111-1",
    });

    expect(all.suppliers.find(({ proveedorId }) => proveedorId === 3)).toMatchObject({
      categorias: [],
    });
    expect(filtered.suppliers.some(({ proveedorId }) => proveedorId === 3)).toBe(
      false,
    );
  });

  it("rejects missing authorization", async () => {
    await expect(list({})).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe("CU15 supplier list controller errors", () => {
  it("maps authorization and persistence failures", async () => {
    for (const [error, code] of [
      [new AccessDeniedError(), "FORBIDDEN"],
      [new Error("database unavailable"), "DATABASE_ERROR"],
    ] as const) {
      const controller = createSupplierQueryController({
        listSuppliers: async () => {
          throw error;
        },
        findSupplier: async () => null,
      });

      await expect(
        controller.handle({}, { channel: "proveedor:listar" }),
      ).resolves.toMatchObject({ ok: false, error: { code } });
    }
  });
});

function list(request: SupplierListRequest) {
  return testDb!.db.transaction((tx) =>
    listSuppliersWithExecutor(tx, schema, request),
  );
}

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-supplier-list-"));
  const client = createClient({
    url: `file:${join(dir, "test.db").replace(/\\/g, "/")}`,
  });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  const migrationsDir = join(process.cwd(), "drizzle/migrations");

  for (const file of (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await client.executeMultiple(
      await readFile(join(migrationsDir, file), "utf8"),
    );
  }

  return { client, db, dir };
}

async function seedFixture(db: TestDatabase["db"]): Promise<void> {
  await db.run(sql`
    INSERT INTO trabajador
      (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
       trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES
      (1, '11111111-1', 'María', 'Dueña', '987654321', '2024-01-01', 'activo'),
      (2, '12345670-K', 'Pedro', 'Trabajador', '912345678', '2024-02-01', 'activo')
  `);
  await db.run(sql`
    INSERT INTO usuario
      (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES
      ('11111111-1', 'dueno', '2026-01-01T00:00:00.000Z', 1),
      ('12345670-K', 'trabajador', '2026-01-01T00:00:00.000Z', 2)
  `);
  await db.run(sql`
    INSERT INTO categoria
      (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES
      (1, 'Lácteos', 1),
      (2, 'Abarrotes', 0),
      (3, 'Bebidas', 0)
  `);
  await db.run(sql`
    INSERT INTO proveedor
      (proveedor_id, proveedor_rut, proveedor_nombre_razon_social,
       proveedor_nombre_contacto, proveedor_telefono,
       proveedor_correo_electronico)
    VALUES
      (1, '12.345.678-5', 'Distribuidora Álamo', 'Ana Pérez', '912345678',
       'ventas@alamo.cl'),
      (2, '12345670-K', 'comercial Norte', 'Luis Díaz', '923456789',
       'contacto@norte.cl'),
      (3, '11.111.111-1', 'Ábaco heredado', 'Eva Soto', '934567890',
       'eva@abaco.cl')
  `);
  await db.run(sql`
    INSERT INTO proveedor_categoria
      (proveedor_categoria_id, proveedor_id, categoria_id)
    VALUES
      ('00000000-0000-4000-8000-000000000101', 1, 1),
      ('00000000-0000-4000-8000-000000000102', 1, 2),
      ('00000000-0000-4000-8000-000000000103', 2, 2)
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
