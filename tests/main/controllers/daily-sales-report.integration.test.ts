import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { loadDailySalesReport } from "../../../src/main/controllers/daily-sales-report-service";

let fixture: Awaited<ReturnType<typeof createFixture>>;
const sale1 = "00000000-0000-4000-8000-000000000451";
const sale2 = "00000000-0000-4000-8000-000000000452";

beforeEach(async () => { fixture = await createFixture(); });
afterEach(async () => {
  if (!fixture) return;
  fixture.client.close();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(fixture.dir, { recursive: true, force: true }); break; }
    catch { if (attempt === 4) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
});

describe("CU46 lectura histórica", () => {
  it("lee vigentes, anuladas, caja cerrada y top neto del día civil chileno", async () => {
    const result = await loadDailySalesReport(fixture.db, "2026-06-12");
    expect(result.tieneVentas).toBe(true);
    expect(result.ventas.map((item) => item.ventaId)).toEqual([sale1, sale2]);
    expect(result.ventas[0]).toMatchObject({ total: 2500, estado: "confirmada", responsable: { nombre: "Ana Histórica" } });
    expect(result.ventas[1]).toMatchObject({ total: 1000, estado: "anulada" });
    expect(result.resumen).toMatchObject({ ventasVigentes: 1, montoVigente: 2500, ventasAnuladas: 1, montoAnulado: 1000 });
    expect(result.resumen.porMetodoPago.efectivo).toEqual({ cantidad: 1, monto: 2500 });
    expect(result.resumen.porMetodoPago.debito).toEqual({ cantidad: 0, monto: 0 });
    expect(result.topProductos).toEqual([
      expect.objectContaining({ productoId: 1, unidades: 2, montoNeto: 1667 }),
      expect.objectContaining({ productoId: 2, unidades: 1, montoNeto: 833 }),
    ]);
    expect(result.caja).toEqual({ estado: "cerrada", fechaHoraCierre: "2026-06-13T02:00:00.000Z" });
  });

  it("da E1 si no hay ventas y conserva reporte cuando solo hay anuladas", async () => {
    expect(await loadDailySalesReport(fixture.db, "2026-06-14")).toMatchObject({ tieneVentas: false, ventas: [], resumen: { montoVigente: 0 } });
    await fixture.db.run(sql`UPDATE venta SET venta_estado = 'anulada' WHERE venta_id = ${sale1}`);
    const result = await loadDailySalesReport(fixture.db, "2026-06-12");
    expect(result).toMatchObject({ tieneVentas: true, resumen: { ventasVigentes: 0, ventasAnuladas: 2 }, topProductos: [] });
  });

  it("rechaza fecha inválida y un precio histórico ausente", async () => {
    await expect(loadDailySalesReport(fixture.db, "2026-02-30")).rejects.toThrow();
    await fixture.client.execute("PRAGMA foreign_keys = OFF");
    await fixture.db.run(sql`UPDATE detalle_venta SET historial_precio_producto_id = '00000000-0000-4000-8000-000000000399' WHERE venta_id = ${sale1}`);
    await expect(loadDailySalesReport(fixture.db, "2026-06-12")).rejects.toThrow();
  });
});

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-cu46-"));
  const client = createClient({ url: `file:${join(dir, "test.db").replace(/\\/g, "/")}` });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of (await readdir(join(process.cwd(), "drizzle/migrations"))).filter((file) => file.endsWith(".sql")).sort()) {
    await client.executeMultiple(await readFile(join(process.cwd(), "drizzle/migrations", file), "utf8"));
  }
  await client.executeMultiple(await readFile(join(process.cwd(), "src/db/triggers.sql"), "utf8"));
  await db.run(sql`INSERT INTO trabajador (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido, trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES (1, '12345678-9', 'Ana', 'Actual', '987654321', '2024-01-01', 'activo')`);
  await db.run(sql`INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id) VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1)`);
  await db.run(sql`INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento) VALUES (1, 'Abarrotes', 0)`);
  await db.run(sql`INSERT INTO producto (producto_id, producto_ean_13, producto_nombre, producto_precio_venta, producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id)
    VALUES (1, '7802920000015', 'Pan', 9999, 1, 'activo', '2026-01-01T00:00:00.000Z', 1),
           (2, '7802920000022', 'Leche', 9999, 1, 'activo', '2026-01-01T00:00:00.000Z', 1)`);
  await db.run(sql`INSERT INTO historial_precio_producto (historial_precio_producto_id, historial_precio_costo, historial_precio_venta, historial_fecha_hora_vigencia_desde, producto_id)
    VALUES ('00000000-0000-4000-8000-000000000301', 700, 1000, '2026-01-01T00:00:00.000Z', 1),
           ('00000000-0000-4000-8000-000000000302', 700, 1000, '2026-01-01T00:00:00.000Z', 2)`);
  await db.run(sql`INSERT INTO cierre_caja (cierre_caja_id, cierre_fecha_hora_inicio, cierre_estado)
    VALUES ('00000000-0000-4000-8000-000000000201', '2026-06-12T08:00:00.000Z', 'abierto')`);
  await db.run(sql`INSERT INTO venta (venta_id, venta_fecha_hora, venta_descuento_tipo, venta_descuento_valor, venta_descuento_razon, venta_metodo_pago, venta_estado, es_venta_efectivo, es_venta_electronica, usuario_cajero_id, venta_responsable_nombre, venta_responsable_rol, cierre_caja_id)
    VALUES (${sale1}, '2026-06-12T17:00:00.000Z', 'monto', 500, 'Promoción', 'efectivo', 'completada', 1, 0, '12345678-9', 'Ana Histórica', 'trabajador', '00000000-0000-4000-8000-000000000201'),
           (${sale2}, '2026-06-12T18:00:00.000Z', 'ninguno', NULL, NULL, 'debito', 'completada', 0, 1, '12345678-9', 'Ana Histórica', 'trabajador', '00000000-0000-4000-8000-000000000201')`);
  await db.run(sql`INSERT INTO detalle_venta (detalle_venta_id, venta_id, producto_id, detalle_venta_cantidad, historial_precio_producto_id)
    VALUES ('00000000-0000-4000-8000-000000000511', ${sale1}, 1, 2, '00000000-0000-4000-8000-000000000301'),
           ('00000000-0000-4000-8000-000000000512', ${sale1}, 2, 1, '00000000-0000-4000-8000-000000000302'),
           ('00000000-0000-4000-8000-000000000513', ${sale2}, 1, 1, '00000000-0000-4000-8000-000000000301')`);
  await db.run(sql`INSERT INTO venta_efectivo (venta_id, venta_efectivo_monto_recibido) VALUES (${sale1}, 3000)`);
  await db.run(sql`INSERT INTO anulacion_venta (anulacion_venta_id, anulacion_fecha_hora, anulacion_razon, venta_id, usuario_id)
    VALUES ('00000000-0000-4000-8000-000000000711', '2026-06-12T20:00:00.000Z', 'Error', ${sale2}, '12345678-9')`);
  await db.run(sql`UPDATE cierre_caja SET cierre_estado = 'cerrado', cierre_fecha_hora_fin = '2026-06-13T02:00:00.000Z', usuario_cierre_id = '12345678-9' WHERE cierre_caja_id = '00000000-0000-4000-8000-000000000201'`);
  return { dir, client, db };
}
