import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryProductsMostSold, createProductsMostSoldController } from "../../../src/main/controllers/products-most-sold";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { authorizeRequest, guardChannel } from "../../../src/main/controllers/auth-guard";
import type { ControllerContext } from "../../../src/main/controllers/base";
import { PRODUCTS_MOST_SOLD_EMPTY_MESSAGE } from "../../../src/shared/products-most-sold";

const period = { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" };
const context: ControllerContext = { channel: "reporte:productos-mas-vendidos", claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" } };
const user = { usuarioId: "owner", role: "dueno" as const, usuarioRol: "dueno", trabajadorNombre: "Ana" };
let client: Client;

beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  await client.executeMultiple(`
    CREATE TABLE venta (venta_id TEXT PRIMARY KEY, venta_fecha_hora TEXT, venta_estado TEXT, venta_descuento_tipo TEXT, venta_descuento_valor INTEGER);
    CREATE TABLE detalle_venta (detalle_venta_id TEXT PRIMARY KEY, venta_id TEXT, producto_id INTEGER, detalle_venta_cantidad INTEGER, historial_precio_producto_id TEXT);
    CREATE TABLE historial_precio_producto (historial_precio_producto_id TEXT PRIMARY KEY, producto_id INTEGER, historial_precio_venta INTEGER);
    CREATE TABLE producto (producto_id INTEGER PRIMARY KEY, producto_ean_13 TEXT, producto_nombre TEXT, categoria_id INTEGER, producto_estado TEXT, producto_precio_venta INTEGER);
    CREATE TABLE categoria (categoria_id INTEGER PRIMARY KEY, categoria_nombre TEXT);
    CREATE TABLE anulacion_venta (venta_id TEXT);
    INSERT INTO categoria VALUES (1, 'Pan'), (2, 'Bebidas');
    INSERT INTO producto VALUES (1, '0000000000001', 'Marraqueta', 1, 'activo', 8000), (2, '0000000000002', 'Jugo', 2, 'activo', 6000);
    INSERT INTO historial_precio_producto VALUES ('p1', 1, 1000), ('p2', 2, 2000);
  `);
});
afterEach(() => client.close());

async function sale(id: string, date: string, state = "completada", type = "ninguno", value = 0) {
  await client.execute({ sql: "INSERT INTO venta VALUES (?, ?, ?, ?, ?)", args: [id, date, state, type, value] });
}
async function detail(id: string, saleId: string, productId: number, quantity: number, priceId = `p${productId}`) {
  await client.execute({ sql: "INSERT INTO detalle_venta VALUES (?, ?, ?, ?, ?)", args: [id, saleId, productId, quantity, priceId] });
}

describe("CU48 C55 products most sold", () => {
  it("uses historical price, current category, inactive products and proportional net amounts", async () => {
    await sale("one", "2026-09-15 15:00:00", "completada", "monto", 500);
    await detail("d1", "one", 1, 1);
    await detail("d2", "one", 2, 2);
    await client.execute("UPDATE producto SET categoria_id = 2, producto_estado = 'inactivo', producto_precio_venta = 9000 WHERE producto_id = 1");
    const report = await queryProductsMostSold(drizzle(client), period);
    expect(report).toMatchObject({ status: "ready", totalUnidadesPeriodo: 3 });
    expect(report.filas).toMatchObject([
      { productoId: 2, unidadesVendidas: 2, ingresoNeto: 3600 },
      { productoId: 1, categoria: "Bebidas", unidadesVendidas: 1, ingresoNeto: 900 },
    ]);
    expect(report.filas[0].porcentajeUnidades).toBeCloseTo(200 / 3);
    expect(report.filas[1].porcentajeUnidades).toBeCloseTo(100 / 3);
    expect(report.filas.reduce((sum, row) => sum + row.ingresoNeto, 0)).toBe(4500);
  });

  it("includes Chilean date endpoints across daylight saving and excludes both annulment forms", async () => {
    await sale("before", "2026-09-01T03:59:59Z"); await detail("d1", "before", 1, 1);
    await sale("start", "2026-09-01T04:00:00Z"); await detail("d2", "start", 1, 2);
    await sale("end", "2026-10-01T02:59:59Z"); await detail("d3", "end", 1, 3);
    await sale("after", "2026-10-01T03:00:00Z"); await detail("d4", "after", 1, 4);
    await sale("void-state", "2026-09-20T12:00:00Z", "anulada"); await detail("d5", "void-state", 1, 5);
    await sale("void-record", "2026-09-20T12:00:00Z"); await detail("d6", "void-record", 1, 6);
    await client.execute("INSERT INTO anulacion_venta VALUES ('void-record')");
    const report = await queryProductsMostSold(drizzle(client), period);
    expect(report.totalUnidadesPeriodo).toBe(5);
    expect(report.filas[0]).toMatchObject({ unidadesVendidas: 5, ingresoNeto: 5000, porcentajeUnidades: 100 });
  });

  it("uses all products in the denominator before top 20 and orders EAN ties", async () => {
    for (let productId = 3; productId <= 21; productId += 1) {
      await client.execute({ sql: "INSERT INTO producto VALUES (?, ?, ?, 1, 'activo', 1000)", args: [productId, String(productId).padStart(13, "0"), `Product ${productId}`] });
      await client.execute({ sql: "INSERT INTO historial_precio_producto VALUES (?, ?, 1000)", args: [`p${productId}`, productId] });
    }
    await sale("one", "2026-09-15T12:00:00Z");
    for (let productId = 1; productId <= 21; productId += 1) await detail(`d${productId}`, "one", productId, 1);
    const report = await queryProductsMostSold(drizzle(client), period);
    expect(report.filas).toHaveLength(20);
    expect(report.totalUnidadesPeriodo).toBe(21);
    expect(report.filas.map((row) => row.productoId)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(report.filas.reduce((sum, row) => sum + row.porcentajeUnidades, 0)).toBeLessThan(100);
  });

  it("keeps zero-income sales with positive units", async () => {
    await sale("free", "2026-09-15T12:00:00Z", "completada", "porcentaje", 100);
    await detail("d1", "free", 1, 3);
    expect(await queryProductsMostSold(drizzle(client), period)).toMatchObject({ status: "ready", totalUnidadesPeriodo: 3, filas: [{ ingresoNeto: 0, unidadesVendidas: 3 }] });
  });

  it("allocates a legacy percentage discount exactly across products", async () => {
    await sale("percent", "2026-09-15T12:00:00Z", "completada", "porcentaje", 25);
    await detail("d1", "percent", 1, 1);
    await detail("d2", "percent", 2, 1);
    const report = await queryProductsMostSold(drizzle(client), period);
    expect(report.filas.reduce((sum, item) => sum + item.ingresoNeto, 0)).toBe(2250);
    expect(report.filas.map((item) => item.ingresoNeto)).toEqual([750, 1500]);
  });

  it("returns an auditable empty result for no eligible lines", async () => {
    await sale("void", "2026-09-15T12:00:00Z", "anulada"); await detail("d1", "void", 1, 1);
    const controller = createProductsMostSoldController(async () => ({ report: await queryProductsMostSold(drizzle(client), period), user }));
    const audit = vi.fn(async () => undefined);
    expect(await handleWithAudit(controller, period, context, audit)).toMatchObject({ ok: true, data: { status: "empty", totalUnidadesPeriodo: 0, filas: [] } });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(PRODUCTS_MOST_SOLD_EMPTY_MESSAGE).toBe("No se encontraron productos vendidos para el período indicado");
  });

  it("validates before the query and does not disguise database errors as empty", async () => {
    const load = vi.fn(async () => { throw new Error("DB down"); });
    const controller = createProductsMostSoldController(load);
    expect(await controller.handle({ fechaInicio: "2026-10-01", fechaTermino: "2026-09-30" }, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(load).not.toHaveBeenCalled();
    expect(await controller.handle(period, context)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });

  it("treats an impossible recorded discount as inconsistent data", async () => {
    await sale("bad", "2026-09-15T12:00:00Z", "completada", "monto", 2000);
    await detail("d1", "bad", 1, 1);
    const controller = createProductsMostSoldController(async () => ({ report: await queryProductsMostSold(drizzle(client), period), user }));
    expect(await controller.handle(period, context)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });

  it("denies worker, temporary-password and revoked sessions before consultation", async () => {
    const load = vi.fn();
    expect(await createProductsMostSoldController(load).handle(period, { ...context, claims: { ...context.claims!, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(load).not.toHaveBeenCalled();
    const audit = vi.fn(async () => undefined);
    const worker = await guardChannel(context.channel, { ...period, __authToken: "x" }, { verifyToken: () => ({ ...context.claims!, rol: "trabajador" }), audit });
    expect(worker.ok).toBe(false);
    const temporary = await guardChannel(context.channel, { ...period, __authToken: "x" }, { verifyToken: () => ({ ...context.claims!, passwordTemporal: true }), audit });
    expect(temporary.ok).toBe(false);
    const revoked = await authorizeRequest(context.channel, period, undefined, { identity: async () => ({ ok: true, context, payload: period }), session: async () => ({ active: false, reason: "sistema" }) });
    expect(revoked.ok).toBe(false);
  });
});
