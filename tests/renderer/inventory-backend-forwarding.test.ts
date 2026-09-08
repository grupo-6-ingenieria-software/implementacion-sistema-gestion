import { createClient } from "@libsql/client";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createLotController, registerLotWithExecutor } from "../../src/main/controllers/lot";
import {
  createProductWithExecutor,
  createProductWriteController,
  normalizeCreatePayload,
} from "../../src/main/controllers/product-write";
import { createWasteController, registerWasteWithExecutor } from "../../src/main/controllers/waste";
import { buildLotRegisterPayload } from "../../src/renderer/src/views/LotCreateView";
import { buildProductFormValues } from "../../src/renderer/src/views/ProductFormView";
import { buildWasteRegisterPayload } from "../../src/renderer/src/views/WasteCreateView";
import { controllers } from "../../src/shared/controllers";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedFixture(testDb.db);
  testDb.queries.length = 0;
});

afterEach(async () => {
  if (!testDb) return;
  testDb.client.close();
  await rm(testDb.dir, { recursive: true, force: true });
  testDb = undefined;
});

describe("inventory view payloads reach SQL validation", () => {
  it("forwards blank product numeric fields without converting them to zero", async () => {
    const formValues = buildProductFormValues({
      ean13: "7802920000046",
      nombre: "Producto nuevo",
      categoriaId: "1",
      precioCosto: "",
      precioVenta: "1200",
      stockMinimo: "",
    });
    expect(Number.isNaN(formValues.precioCosto)).toBe(true);
    expect(Number.isNaN(formValues.stockMinimo)).toBe(true);

    const controller = createProductWriteController({
      channel: "producto:registrar",
      controllerId: "product-create",
      metadata: controllers[9],
      normalize: normalizeCreatePayload,
      dependencies: {
        save: (payload) => testDb!.db.transaction(async (tx) => {
          await createProductWithExecutor(tx, schema, payload);
          return { ean13: payload.ean13 };
        }),
      },
    });
    const response = await controller.handle(
      { ...formValues, usuarioId: "12345678-9" },
      { channel: "producto:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", fieldErrors: {
        precioCosto: expect.any(String), stockMinimo: expect.any(String),
      } },
    });
    expect(testDb!.queries.some(isScalarValidation)).toBe(true);
  });

  it("forwards blank lot quantity and cost to the lot SQL validator", async () => {
    const payload = buildLotRegisterPayload({
      ean13: "7802920000015",
      cantidad: "",
      precioCosto: "",
      fechaVencimiento: "2027-01-01",
      proveedorId: "1",
    }, "12345678-9");
    const controller = createLotController({
      listProviders: async () => [],
      register: (input) => testDb!.db.transaction((tx) =>
        registerLotWithExecutor(tx, schema, input)),
    });
    const response = await controller.handle(payload, { channel: "lote:registrar" });

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", fieldErrors: {
        cantidad: expect.any(String), precioCosto: expect.any(String),
      } },
    });
    expect(testDb!.queries.some(isScalarValidation)).toBe(true);
  });

  it("forwards blank waste quantity after product and lot lookups", async () => {
    const payload = buildWasteRegisterPayload({
      ean13: "7802920000015",
      cantidad: "",
      motivo: "dano",
      observacion: "envase roto",
    }, "12345678-9");
    const controller = createWasteController({
      availability: async () => ({
        ean13: payload.ean13, stockDisponible: 5, criterioSalida: "fefo",
      }),
      register: (input) => testDb!.db.transaction((tx) =>
        registerWasteWithExecutor(tx, schema, input)),
    });
    const response = await controller.handle(payload, { channel: "merma:registrar" });

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", fieldErrors: { cantidad: expect.any(String) } },
    });
    const statements = testDb!.queries.map((query) => query.toLowerCase());
    expect(statements.findIndex((query) => query.includes('from "producto"'))).toBeLessThan(
      statements.findIndex(isScalarValidation),
    );
    expect(statements.findIndex((query) => query.includes('from "lote"'))).toBeLessThan(
      statements.findIndex(isScalarValidation),
    );
  });
});

function isScalarValidation(query: string): boolean {
  const normalized = query.toLowerCase();
  return normalized.trimStart().startsWith("select") && !normalized.includes(" from ");
}

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-inventory-view-"));
  const client = createClient({ url: `file:${join(dir, "test.db").replace(/\\/g, "/")}` });
  const queries: string[] = [];
  const db = drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of (await readdir(join(process.cwd(), "drizzle/migrations")))
    .filter((name) => name.endsWith(".sql")).sort()) {
    const migration = await readFile(join(process.cwd(), "drizzle/migrations", file), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement.trim());
    }
  }
  return { client, db, dir, queries };
}

async function seedFixture(db: TestDatabase["db"]): Promise<void> {
  await db.run(sql`INSERT INTO trabajador
    (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
     trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo')`);
  await db.run(sql`INSERT INTO usuario
    (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1)`);
  await db.run(sql`INSERT INTO categoria
    (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Lacteos', 1)`);
  await db.run(sql`INSERT INTO producto
    (producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
     producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id)
    VALUES (1, '7802920000015', 'Leche', 1000, 1, 'activo', '2026-01-01', 1)`);
  await db.run(sql`INSERT INTO proveedor
    (proveedor_id, proveedor_rut, proveedor_nombre_razon_social,
     proveedor_nombre_contacto, proveedor_telefono, proveedor_correo_electronico)
    VALUES (1, '76543210-K', 'Proveedor', 'Juan', '912345678', 'p@example.com')`);
  await db.run(sql`INSERT INTO lote
    (lote_id, lote_cantidad_inicial, lote_cantidad_actual, lote_precio_costo,
     lote_fecha_hora_ingreso, es_lote_perecible, es_lote_no_perecible, producto_id, proveedor_id)
    VALUES ('00000000-0000-4000-8000-000000000101', 5, 5, 700,
      '2026-01-01', 1, 0, 1, 1)`);
  await db.run(sql`INSERT INTO lote_perecible
    (lote_id, lote_perecible_fecha_vencimiento)
    VALUES ('00000000-0000-4000-8000-000000000101', '2027-01-01')`);
}
