import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  ProductWriteError,
  createProductWithExecutor,
  editProductWithExecutor,
} from "../../../src/main/controllers/product-write";
import { queryInventoryProducts } from "../../../src/main/controllers/product-query";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedFixture(testDb.db);
});

afterEach(async () => {
  testDb?.client.close();
  if (testDb) await rm(testDb.dir, { recursive: true, force: true });
  testDb = undefined;
});

describe("product write persistence", () => {
  it("checks EAN and category before field validation without partial writes", async () => {
    const invalid = {
      usuarioId: "12345678-9",
      ean13: "123",
      nombre: "",
      categoriaId: 99,
      precioCosto: -1,
      precioVenta: 0,
      stockMinimo: -1,
    };

    await expect(
      testDb!.db.transaction((tx) =>
        createProductWithExecutor(tx, schema, invalid),
      ),
    ).rejects.toMatchObject({
      reason: "category-not-found",
    } satisfies Partial<ProductWriteError>);

    await expect(
      testDb!.db.transaction((tx) =>
        createProductWithExecutor(tx, schema, { ...invalid, categoriaId: 1 }),
      ),
    ).rejects.toMatchObject({
      reason: "validation",
    } satisfies Partial<ProductWriteError>);

    const rows = await testDb!.db.all<{ products: number; prices: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM producto) AS products,
        (SELECT COUNT(*) FROM historial_precio_producto) AS prices
    `);
    expect(rows[0]).toEqual({ products: 0, prices: 0 });
  });

  it("creates product, current price, user version and audit atomically", async () => {
    await testDb!.db.transaction((tx) =>
      createProductWithExecutor(tx, schema, {
        usuarioId: "12345678-9",
        ean13: "7802920000015",
        nombre: "Leche",
        categoriaId: 1,
        precioCosto: 700,
        precioVenta: 1000,
        stockMinimo: 3,
      }),
    );

    const rows = await testDb!.db.all<{
      products: number;
      prices: number;
      versions: number;
      audits: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM producto) AS products,
        (SELECT COUNT(*) FROM historial_precio_producto WHERE historial_fecha_hora_vigencia_hasta IS NULL) AS prices,
        (SELECT COUNT(*) FROM usuario_version) AS versions,
        (SELECT COUNT(*) FROM log_auditoria) AS audits
    `);
    expect(rows[0]).toEqual({ products: 1, prices: 1, versions: 1, audits: 1 });
  });

  it("checks product, category and current price before editing the normalized history", async () => {
    await testDb!.db.transaction((tx) =>
      createProductWithExecutor(tx, schema, {
        usuarioId: "12345678-9",
        ean13: "7802920000015",
        nombre: "Leche",
        categoriaId: 1,
        precioCosto: 700,
        precioVenta: 1000,
        stockMinimo: 3,
      }),
    );

    await expect(
      testDb!.db.transaction((tx) =>
        editProductWithExecutor(tx, schema, {
          usuarioId: "12345678-9",
          originalEan13: "7802920000015",
          ean13: "7802920000015",
          nombre: "",
          categoriaId: 99,
          precioCosto: 800,
          precioVenta: 1200,
          stockMinimo: 3,
        }),
      ),
    ).rejects.toMatchObject({
      reason: "category-not-found",
    } satisfies Partial<ProductWriteError>);

    await testDb!.db.transaction((tx) =>
      editProductWithExecutor(tx, schema, {
        usuarioId: "12345678-9",
        originalEan13: "7802920000015",
        ean13: "7802920000015",
        nombre: "Leche editada",
        categoriaId: 1,
        precioCosto: 800,
        precioVenta: 1200,
        stockMinimo: 4,
      }),
    );

    const prices = await testDb!.db.all<{
      current: number;
      closed: number;
    }>(sql`
      SELECT
        SUM(CASE WHEN historial_fecha_hora_vigencia_hasta IS NULL THEN 1 ELSE 0 END) AS current,
        SUM(CASE WHEN historial_fecha_hora_vigencia_hasta IS NOT NULL THEN 1 ELSE 0 END) AS closed
      FROM historial_precio_producto
    `);
    expect(prices[0]).toEqual({ current: 1, closed: 1 });
  });

  it("filters active products, requires exact EAN and orders the SQL result", async () => {
    await testDb!.db.run(sql`
      INSERT INTO producto
        (producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
         producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id)
      VALUES
        (1, '7802920000015', 'Leche', 1000, 1, 'activo', '2026-01-01T00:00:00.000Z', 1),
        (2, '7802920000022', 'Yogur', 900, 1, 'activo', '2026-01-01T00:00:00.000Z', 1),
        (3, '7802920000039', 'Queso', 2500, 1, 'inactivo', '2026-01-01T00:00:00.000Z', 1)
    `);
    await testDb!.db.run(sql`
      INSERT INTO lote
        (lote_id, lote_cantidad_inicial, lote_cantidad_actual, lote_precio_costo,
         lote_fecha_hora_ingreso, es_lote_perecible, es_lote_no_perecible, producto_id)
      VALUES
        ('00000000-0000-4000-8000-000000000101', 2, 2, 700, '2026-01-01', 1, 0, 1),
        ('00000000-0000-4000-8000-000000000102', 5, 5, 600, '2026-01-01', 1, 0, 2),
        ('00000000-0000-4000-8000-000000000103', 9, 9, 1500, '2026-01-01', 1, 0, 3)
    `);

    const ordered = await queryInventoryProducts(testDb!.db, schema, {
      filters: {
        search: "",
        estado: "activo",
        sortBy: "stockActual",
        sortDirection: "desc",
      },
      includeCost: false,
    });
    const partialEan = await queryInventoryProducts(testDb!.db, schema, {
      filters: {
        search: "780292000001",
        estado: "activo",
        sortBy: "nombre",
        sortDirection: "asc",
      },
      includeCost: false,
    });
    const exactEan = await queryInventoryProducts(testDb!.db, schema, {
      filters: {
        search: "7802920000015",
        estado: "activo",
        sortBy: "nombre",
        sortDirection: "asc",
      },
      includeCost: false,
    });

    expect(ordered.map((product) => product.ean13)).toEqual([
      "7802920000022",
      "7802920000015",
    ]);
    expect(partialEan).toEqual([]);
    expect(exactEan.map((product) => product.ean13)).toEqual(["7802920000015"]);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-product-write-"));
  const client = createClient({
    url: `file:${join(dir, "test.db").replace(/\\/g, "/")}`,
  });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys = ON");
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  for (const file of (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(join(migrationsDir, file), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement.trim());
    }
  }
  return { client, db, dir };
}

async function seedFixture(db: TestDatabase["db"]): Promise<void> {
  await db.run(sql`
    INSERT INTO trabajador
      (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
       trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo')
  `);
  await db.run(sql`
    INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1)
  `);
  await db.run(sql`
    INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Lacteos', 1)
  `);
}
