import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { loadSaleCategories } from "../../../src/main/controllers/sale-categories-service";
import type { SaleCategoryDb } from "../../../src/main/controllers/sale-categories-service";

const owner = { usuarioId: "12345678-9", rol: "dueno" as const };
const worker = { usuarioId: "12345678-9", rol: "trabajador" as const };
const otherWorker = { usuarioId: "11111111-1", rol: "trabajador" as const };
const range = { fechaInicio: "2026-06-12", fechaTermino: "2026-06-12" };
const id = (suffix: string) => `00000000-0000-4000-8000-000000000${suffix}`;
type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createFixture();
  await seed(fixture.db);
});

afterEach(async () => {
  if (!fixture) return;
  fixture.client.close();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(fixture.dir, { recursive: true, force: true });
      break;
    } catch {
      if (attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  fixture = undefined;
});

describe("CU45 category sales integration", () => {
  it("allocates each complete sale, uses historical prices and restricts workers in SQL", async () => {
    const [all, own, other] = await Promise.all([
      loadSaleCategories(fixture!.db, range, owner),
      loadSaleCategories(fixture!.db, range, worker),
      loadSaleCategories(fixture!.db, range, otherWorker),
    ]);
    expect(all).toEqual({
      categorias: [
        { categoriaId: 1, categoriaNombre: "Abarrotes", unidadesVendidas: 2, montoNeto: 199 },
        { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 2, montoNeto: 200 },
      ],
      totales: { unidadesVendidas: 4, montoNeto: 399 },
    });
    expect(own.totales).toEqual({ unidadesVendidas: 3, montoNeto: 299 });
    expect(other.totales).toEqual({ unidadesVendidas: 1, montoNeto: 100 });
    expect(other.categorias).toEqual([
      { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 1, montoNeto: 100 },
    ]);
  });

  it("reflects current category and includes a product deactivated after sale", async () => {
    await fixture!.db.run(sql`
      UPDATE producto SET categoria_id = 2, producto_estado = 'inactivo'
      WHERE producto_id = 1
    `);
    const result = await loadSaleCategories(fixture!.db, range, owner);
    expect(result.categorias).toEqual([
      { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 4, montoNeto: 399 },
    ]);
  });

  it("treats no eligible sales as a successful empty response and leaves data intact", async () => {
    const before = await fixture!.db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM venta`);
    const noSales = await loadSaleCategories(
      fixture!.db,
      { fechaInicio: "2026-06-13", fechaTermino: "2026-06-13" },
      worker,
    );
    expect(noSales).toEqual({
      categorias: [],
      totales: { unidadesVendidas: 0, montoNeto: 0 },
    });
    expect(await fixture!.db.all(sql`SELECT COUNT(*) AS count FROM venta`)).toEqual(before);
    expect(await fixture!.db.all(sql`SELECT COUNT(*) AS count FROM detalle_venta`)).toEqual([
      { count: 4 },
    ]);
  });

  it("returns E2 for an annulled own sale and sales owned by someone else", async () => {
    await fixture!.db.run(sql`
      INSERT INTO anulacion_venta (anulacion_venta_id, anulacion_fecha_hora,
        anulacion_razon, venta_id, usuario_id)
      VALUES (${id("702")}, '2026-06-12T19:00:00.000Z', 'Error',
        ${id("401")}, '12345678-9')
    `);
    expect(await loadSaleCategories(fixture!.db, range, worker)).toEqual({
      categorias: [], totales: { unidadesVendidas: 0, montoNeto: 0 },
    });
    expect((await loadSaleCategories(fixture!.db, range, owner)).totales.montoNeto).toBe(100);

    await fixture!.db.run(sql`
      UPDATE venta SET venta_fecha_hora = '2026-06-11T17:00:00.000Z'
      WHERE venta_id = ${id("402")}
    `);
    expect(await loadSaleCategories(fixture!.db, range, owner)).toEqual({
      categorias: [], totales: { unidadesVendidas: 0, montoNeto: 0 },
    });
  });
});

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-cu45-"));
  const path = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${path}` });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys = ON");
  const migrationDir = join(process.cwd(), "drizzle/migrations");
  for (const file of (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort()) {
    await client.executeMultiple(await readFile(join(migrationDir, file), "utf8"));
  }
  await client.executeMultiple(await readFile(join(process.cwd(), "src/db/triggers.sql"), "utf8"));
  return { client, db, dir };
}

async function seed(db: SaleCategoryDb & { run: (query: ReturnType<typeof sql>) => Promise<unknown> }) {
  await db.run(sql`
    INSERT INTO trabajador (trabajador_id, trabajador_rut, trabajador_nombre,
      trabajador_apellido, trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES (1, '12345678-9', 'Ana', 'Uno', '987654321', '2024-01-01', 'activo'),
      (2, '11111111-1', 'Bea', 'Dos', '987654322', '2024-01-01', 'activo')
  `);
  await db.run(sql`
    INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1),
      ('11111111-1', 'trabajador', '2026-01-01T00:00:00.000Z', 2)
  `);
  await db.run(sql`
    INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Abarrotes', 0), (2, 'Bebidas', 0)
  `);
  await db.run(sql`
    INSERT INTO producto (producto_id, producto_ean_13, producto_nombre,
      producto_precio_venta, producto_stock_minimo, producto_estado,
      producto_fecha_registro, categoria_id)
    VALUES (1, '7802920000015', 'Pan', 9000, 0, 'activo', '2026-01-01T00:00:00.000Z', 1),
      (2, '7802920000022', 'Agua', 9000, 0, 'activo', '2026-01-01T00:00:00.000Z', 2)
  `);
  await db.run(sql`
    INSERT INTO historial_precio_producto (historial_precio_producto_id,
      historial_precio_costo, historial_precio_venta,
      historial_fecha_hora_vigencia_desde, producto_id)
    VALUES (${id("301")}, 50, 100, '2026-01-01T00:00:00.000Z', 1),
      (${id("302")}, 50, 100, '2026-01-01T00:00:00.000Z', 2)
  `);
  await db.run(sql`
    INSERT INTO cierre_caja (cierre_caja_id, cierre_fecha_hora_inicio, cierre_estado)
    VALUES (${id("201")}, '2026-06-12T04:00:00.000Z', 'abierto')
  `);
  await db.run(sql`
    INSERT INTO venta (venta_id, venta_fecha_hora, venta_descuento_tipo,
      venta_descuento_valor, venta_descuento_razon, venta_metodo_pago,
      venta_estado, es_venta_efectivo, es_venta_electronica,
      usuario_cajero_id, venta_responsable_nombre, venta_responsable_rol, cierre_caja_id)
    VALUES (${id("401")}, '2026-06-12T04:00:00.000Z', 'monto', 1, 'Promoción',
      'efectivo', 'completada', 1, 0, '12345678-9', 'Ana Uno', 'trabajador', ${id("201")}),
      (${id("402")}, '2026-06-13T03:59:59.000Z', 'ninguno', NULL, NULL,
      'debito', 'completada', 0, 1, '11111111-1', 'Bea Dos', 'trabajador', ${id("201")}),
      (${id("403")}, '2026-06-12T17:00:00.000Z', 'ninguno', NULL, NULL,
      'efectivo', 'completada', 1, 0, '12345678-9', 'Ana Uno', 'trabajador', ${id("201")})
  `);
  await db.run(sql`
    INSERT INTO detalle_venta (detalle_venta_id, venta_id, producto_id,
      detalle_venta_cantidad, historial_precio_producto_id)
    VALUES (${id("501")}, ${id("401")}, 1, 2, ${id("301")}),
      (${id("502")}, ${id("401")}, 2, 1, ${id("302")}),
      (${id("503")}, ${id("402")}, 2, 1, ${id("302")}),
      (${id("504")}, ${id("403")}, 1, 1, ${id("301")})
  `);
  await db.run(sql`
    INSERT INTO anulacion_venta (anulacion_venta_id, anulacion_fecha_hora,
      anulacion_razon, venta_id, usuario_id)
    VALUES (${id("701")}, '2026-06-12T18:00:00.000Z', 'Error', ${id("403")}, '12345678-9')
  `);
}
