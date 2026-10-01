import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryCategoryProfitability } from "../../../src/main/controllers/category-profitability-service";
import { createCategoryProfitabilityController } from "../../../src/main/controllers/category-profitability";
import { guardChannel, authorizeRequest } from "../../../src/main/controllers/auth-guard";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { evaluateRouteAccess, getVisibleMenu } from "../../../src/shared/navigation";
import { parseProfitabilityPeriod, PROFITABILITY_RANGE_ERROR } from "../../../src/shared/category-profitability";
import type { ControllerContext } from "../../../src/main/controllers/base";

const periodo = { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" };
const context: ControllerContext = {
  channel: "reporte:rentabilidad-categoria",
  claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" },
};
const user = { usuarioId: "owner", role: "dueno" as const, usuarioRol: "dueno", trabajadorNombre: "Ana" };
let client: Client;

beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  await client.executeMultiple(`
    CREATE TABLE venta (venta_id TEXT PRIMARY KEY, venta_fecha_hora TEXT, venta_estado TEXT, venta_descuento_tipo TEXT, venta_descuento_valor INTEGER);
    CREATE TABLE detalle_venta (detalle_venta_id TEXT PRIMARY KEY, venta_id TEXT, producto_id INTEGER, detalle_venta_cantidad INTEGER, historial_precio_producto_id TEXT);
    CREATE TABLE historial_precio_producto (historial_precio_producto_id TEXT PRIMARY KEY, historial_precio_venta INTEGER);
    CREATE TABLE anulacion_venta (venta_id TEXT);
    CREATE TABLE producto (producto_id INTEGER PRIMARY KEY, categoria_id INTEGER, producto_precio_venta INTEGER, producto_estado TEXT);
    CREATE TABLE categoria (categoria_id INTEGER PRIMARY KEY, categoria_nombre TEXT);
    CREATE TABLE lote (lote_id TEXT PRIMARY KEY, producto_id INTEGER, lote_precio_costo INTEGER, lote_cantidad_actual INTEGER);
    CREATE TABLE venta_lote (venta_id TEXT, lote_id TEXT, venta_lote_cantidad_consumida INTEGER);
    INSERT INTO categoria VALUES (1, 'Panadería'), (2, 'Bebidas'), (3, 'Sin costo');
    INSERT INTO producto VALUES (1, 1, 9000, 'inactivo'), (2, 2, 9000, 'activo'), (3, 3, 9000, 'activo');
    INSERT INTO historial_precio_producto VALUES ('historico', 100), ('actual', 9000);
    INSERT INTO lote VALUES ('pan-1', 1, 20, 0), ('pan-2', 1, 40, 0), ('bebida', 2, 80, 0), ('gratis', 3, 0, 0);
  `);
});
afterEach(() => client.close());

async function sale(id: string, fecha = "2026-09-15T15:00:00Z", discountType = "ninguno", discount = 0) {
  await client.execute({ sql: "INSERT INTO venta VALUES (?, ?, 'completada', ?, ?)", args: [id, fecha, discountType, discount] });
}
async function line(ventaId: string, id: string, productoId: number, lots: [string, number][]) {
  await client.execute({ sql: "INSERT INTO detalle_venta VALUES (?, ?, ?, ?, 'historico')", args: [id, ventaId, productoId, lots.reduce((sum, [, quantity]) => sum + quantity, 0)] });
  for (const [lote, quantity] of lots) {
    await client.execute({ sql: "INSERT INTO venta_lote VALUES (?, ?, ?)", args: [ventaId, lote, quantity] });
  }
}
const query = () => queryCategoryProfitability(drizzle(client), periodo);

describe("RF51 CU51 V42 C58", () => {
  it("prorates the entire sale, sums consumed lots once and orders profit on cost", async () => {
    await sale("s1", undefined, "monto", 1);
    await line("s1", "a", 1, [["pan-1", 1], ["pan-2", 1]]);
    await line("s1", "b", 2, [["bebida", 1]]);
    await line("s1", "c", 3, [["gratis", 1]]);
    const report = await query();
    expect(report).toEqual({ periodo, categorias: [
      { categoriaId: 1, categoriaNombre: "Panadería", unidadesVendidas: 2, costoTotal: 60, ingresoNeto: 199, gananciaPorcentual: 231.67 },
      { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 1, costoTotal: 80, ingresoNeto: 100, gananciaPorcentual: 25 },
      { categoriaId: 3, categoriaNombre: "Sin costo", unidadesVendidas: 1, costoTotal: 0, ingresoNeto: 100, gananciaPorcentual: null },
    ] });
    expect(report.categorias.reduce((sum, row) => sum + row.ingresoNeto, 0)).toBe(399);
  });

  it("rounds discount ties by line id and keeps zero income and negative profitability", async () => {
    await sale("s1", undefined, "monto", 1);
    await line("s1", "a", 1, [["pan-1", 1]]);
    await line("s1", "b", 2, [["bebida", 1]]);
    expect((await query()).categorias.map((row) => row.ingresoNeto)).toEqual([99, 100]);
    await client.execute("UPDATE venta SET venta_descuento_tipo = 'porcentaje', venta_descuento_valor = 100");
    expect((await query()).categorias.map((row) => [row.ingresoNeto, row.gananciaPorcentual])).toEqual([[0, -100], [0, -100]]);
  });

  it("uses the current master category for both historical income and lot costs", async () => {
    await sale("s1");
    await line("s1", "a", 1, [["pan-1", 1], ["pan-2", 1]]);
    await line("s1", "b", 2, [["bebida", 1]]);
    await client.execute("UPDATE producto SET categoria_id = 2 WHERE producto_id = 1");
    expect((await query()).categorias).toEqual([
      { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 3, costoTotal: 140, ingresoNeto: 300, gananciaPorcentual: 114.29 },
    ]);
  });

  it("excludes both forms of annulment and respects Santiago boundaries across DST", async () => {
    const dates = ["2026-09-01T03:59:59Z", "2026-09-01T04:00:00Z", "2026-10-01T02:59:59Z", "2026-10-01T03:00:00Z", "2026-09-20T12:00:00Z", "2026-09-21T12:00:00Z"];
    for (const [i, date] of dates.entries()) {
      await sale(`s${i}`, date);
      await line(`s${i}`, `d${i}`, 1, [["pan-1", 1]]);
    }
    await client.execute("UPDATE venta SET venta_estado = 'anulada' WHERE venta_id = 's4'");
    await client.execute("INSERT INTO anulacion_venta VALUES ('s5')");
    expect((await query()).categorias[0]).toMatchObject({ unidadesVendidas: 2, costoTotal: 40, ingresoNeto: 200 });
  });

  it("returns an empty successful table for E1 without mutating sales", async () => {
    const controller = createCategoryProfitabilityController(async () => ({ report: await query(), user }));
    expect(await controller.handle(periodo, context)).toEqual({ ok: true, data: { periodo, categorias: [] } });
    expect((await client.execute("SELECT COUNT(*) AS count FROM venta")).rows[0].count).toBe(0);
  });

  it("does not mistake missing lot consumption for a zero-cost category", async () => {
    await sale("s1");
    await line("s1", "a", 1, [["pan-1", 1]]);
    await client.execute("DELETE FROM venta_lote");
    await expect(query()).rejects.toThrow("incoherentes");
  });

  it("rejects E3 before consulting data and preserves the exact message", async () => {
    const load = vi.fn();
    const controller = createCategoryProfitabilityController(load);
    expect(await controller.handle({ fechaInicio: "2026-09-30", fechaTermino: "2026-09-01" }, context)).toMatchObject({
      ok: false, error: { code: "VALIDATION_ERROR", message: PROFITABILITY_RANGE_ERROR },
    });
    expect(load).not.toHaveBeenCalled();
    for (const payload of [null, {}, { ...periodo, fechaInicio: "2026-02-30" }, { ...periodo, fechaTermino: "invalid" }]) {
      expect(() => parseProfitabilityPeriod(payload)).toThrow(RangeError);
    }
  });

  it("allows only the owner through navigation, IPC and the controller", async () => {
    const load = vi.fn();
    const audit = vi.fn(async () => undefined);
    const worker = { ...context.claims!, rol: "trabajador" as const };
    expect(getVisibleMenu("dueno").some((node) => node.id === "category-profitability")).toBe(true);
    expect(getVisibleMenu("trabajador").some((node) => node.id === "category-profitability")).toBe(false);
    expect(evaluateRouteAccess("/app/reportes/rentabilidad", { isAuthenticated: true, role: "trabajador" })).toMatchObject({ status: "deny", to: "/app/inicio" });
    expect(await guardChannel(context.channel, periodo, { verifyToken: () => worker, audit })).toMatchObject({ ok: false });
    expect(audit).toHaveBeenCalledOnce();
    expect(await createCategoryProfitabilityController(load).handle(periodo, { ...context, claims: worker })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(load).not.toHaveBeenCalled();
  });

  it("preserves temporary password and revoked-session restrictions", async () => {
    expect(await guardChannel(context.channel, periodo, { verifyToken: () => ({ ...context.claims!, passwordTemporal: true }), audit: vi.fn(async () => undefined) })).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
    expect(await authorizeRequest(context.channel, periodo, undefined, {
      identity: async () => ({ ok: true, context, payload: periodo }),
      session: async () => ({ active: false, reason: "sistema" }),
    })).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
  });

  it("audits successful queries using the authenticated owner", async () => {
    const audit = vi.fn();
    const controller = createCategoryProfitabilityController(async () => ({ report: await query(), user }));
    await handleWithAudit(controller, { ...periodo, usuarioId: "fake" }, context, audit);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usuarioId: "owner", modulo: "reportes", tipoAccion: "consulta" }));
  });
});
