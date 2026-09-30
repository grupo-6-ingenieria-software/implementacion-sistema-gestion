import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryMonthlySales, createMonthlySalesController } from "../../../src/main/controllers/monthly-sales";
import { guardChannel, authorizeRequest } from "../../../src/main/controllers/auth-guard";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { MONTHLY_SALES_EMPTY_MESSAGE } from "../../../src/shared/monthly-sales";
import type { ControllerContext } from "../../../src/main/controllers/base";

export const ownerContext: ControllerContext = {
  channel: "reporte:ventas-mensuales",
  claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" },
};
let client: Client;
beforeEach(async () => {
  client = createClient({ url: "file::memory:" });
  await client.executeMultiple(`
    CREATE TABLE venta (venta_id TEXT PRIMARY KEY, venta_fecha_hora TEXT, venta_metodo_pago TEXT, venta_estado TEXT, venta_descuento_tipo TEXT, venta_descuento_valor INTEGER);
    CREATE TABLE detalle_venta (venta_id TEXT, detalle_venta_cantidad INTEGER, historial_precio_producto_id TEXT);
    CREATE TABLE historial_precio_producto (historial_precio_producto_id TEXT PRIMARY KEY, historial_precio_venta INTEGER);
    CREATE TABLE anulacion_venta (venta_id TEXT);
    INSERT INTO historial_precio_producto VALUES ('historico', 1000), ('actual', 7000);
  `);
});
afterEach(() => client.close());

async function sale(id: string, fecha: string, options: { amount?: number; percent?: number; state?: string; method?: string; quantity?: number } = {}) {
  await client.execute({ sql: "INSERT INTO venta VALUES (?, ?, ?, ?, ?, ?)", args: [id, fecha, options.method ?? "efectivo", options.state ?? "completada", options.percent !== undefined ? "porcentaje" : options.amount !== undefined ? "monto" : "ninguno", options.percent ?? options.amount ?? 0] });
  await client.execute({ sql: "INSERT INTO detalle_venta VALUES (?, ?, 'historico')", args: [id, options.quantity ?? 1] });
}

describe("RF47 CU47 CP54", () => {
  it("uses historical prices, one transaction per sale and net totals without annulled sales", async () => {
    await sale("previous", "2026-08-15 16:00:00", { quantity: 2 });
    await sale("cash", "2026-09-01 04:00:00", { quantity: 3, amount: 500 });
    await client.execute("INSERT INTO detalle_venta VALUES ('cash', 1, 'historico')");
    await sale("card", "2026-09-15T15:00:00Z", { percent: 10, method: "debito" });
    await sale("void", "2026-09-20 16:00:00", { state: "anulada" });
    await sale("void-record", "2026-09-21 16:00:00");
    await client.execute("INSERT INTO anulacion_venta VALUES ('void-record')");
    const report = await queryMonthlySales(drizzle(client), { mes: 9, anio: 2026 });
    expect(report).toMatchObject({ transacciones: 2, montoTotal: 4400, montoMesAnterior: 2000, variacionPorcentual: 120 });
    expect(report.dias).toHaveLength(30);
    expect(report.dias[0]).toEqual({ fecha: "2026-09-01", transacciones: 1, monto: 3500 });
    expect(report.dias[1].monto).toBe(0);
    expect(report.metodos.find((item) => item.metodo === "debito")).toMatchObject({ transacciones: 1, monto: 900 });
    expect(report.metodos.reduce((sum, item) => sum + item.monto, 0)).toBe(report.montoTotal);
  });

  it("uses Chilean month boundaries across the daylight saving change", async () => {
    await sale("last-august", "2026-09-01T03:59:59Z");
    await sale("first-september", "2026-09-01T04:00:00Z");
    await sale("last-september", "2026-10-01T02:59:59Z");
    await sale("first-october", "2026-10-01T03:00:00Z");
    const report = await queryMonthlySales(drizzle(client), { mes: 9, anio: 2026 });
    expect(report).toMatchObject({ transacciones: 2, montoTotal: 2000, montoMesAnterior: 1000 });
    expect(report.dias[29].transacciones).toBe(1);
  });

  it("compares January to December of the previous year", async () => {
    await sale("december", "2025-12-15T15:00:00Z", { quantity: 2 });
    await sale("january", "2026-01-15T15:00:00Z");
    expect(await queryMonthlySales(drizzle(client), { mes: 1, anio: 2026 })).toMatchObject({ montoMesAnterior: 2000, montoTotal: 1000, variacionPorcentual: -50 });
  });

  it("includes leap day and returns N/A for a zero previous total", async () => {
    await sale("free-previous", "2024-01-15T15:00:00Z", { amount: 1000 });
    await sale("leap-day", "2024-02-29T15:00:00Z");
    const report = await queryMonthlySales(drizzle(client), { mes: 2, anio: 2024 });
    expect(report.dias).toHaveLength(29);
    expect(report.dias[28].monto).toBe(1000);
    expect(report.variacionPorcentual).toBeNull();
  });

  it("does not confuse a completed zero-value sale with an empty month", async () => {
    await sale("free", "2026-02-15T15:00:00Z", { amount: 1000 });
    const report = await queryMonthlySales(drizzle(client), { mes: 2, anio: 2026 });
    expect(report).toMatchObject({ transacciones: 1, montoTotal: 0 });
    expect(report.dias).toHaveLength(28);
  });

  it("returns the exact E1 message when there are only annulled sales", async () => {
    await sale("previous", "2026-08-15T15:00:00Z");
    await sale("void", "2026-09-15T15:00:00Z", { state: "anulada" });
    const controller = createMonthlySalesController(async (period) => ({ report: await queryMonthlySales(drizzle(client), period as { mes: number; anio: number }), user: { usuarioId: "owner", role: "dueno", usuarioRol: "dueno", trabajadorNombre: "Ana" } }));
    expect(await controller.handle({ mes: 9, anio: 2026 }, ownerContext)).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE", message: MONTHLY_SALES_EMPTY_MESSAGE } });
  });

  it.each([{ mes: 0, anio: 2026 }, { mes: 13, anio: 2026 }, { mes: 2.5, anio: 2026 }, { mes: 2, anio: "2026" }, null])("rejects invalid periods before querying: %j", async (period) => {
    const load = vi.fn();
    expect(await createMonthlySalesController(load).handle(period, ownerContext)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(load).not.toHaveBeenCalled();
  });

  it("audits an authorized report query", async () => {
    await sale("sale", "2026-09-15T15:00:00Z");
    const report = await queryMonthlySales(drizzle(client), { mes: 9, anio: 2026 });
    const controller = createMonthlySalesController(async () => ({ report, user: { usuarioId: "owner", role: "dueno", usuarioRol: "dueno", trabajadorNombre: "Ana" } }));
    const audit = vi.fn(async () => undefined);
    await handleWithAudit(controller, report.periodo, ownerContext, audit);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tipoAccion: "consulta", modulo: "reportes", usuarioId: "owner" }));
  });

  it("denies and audits worker query/export attempts but preserves restock exports", async () => {
    const audit = vi.fn(async () => undefined);
    const claims = { ...ownerContext.claims!, rol: "trabajador" as const };
    const deps = { verifyToken: () => claims, audit };
    for (const channel of ["reporte:ventas-mensuales", "reporte:exportar-pdf", "reporte:exportar-xlsx"]) {
      const result = await guardChannel(channel, { tipo: "ventas-mensuales", usuarioId: "owner" }, deps);
      expect(result.ok).toBe(false);
    }
    expect(audit).toHaveBeenCalledTimes(3);
    expect((await guardChannel("reporte:exportar-pdf", {}, deps)).ok).toBe(true);
  });

  it("rejects revoked sessions before loading the report", async () => {
    const result = await authorizeRequest("reporte:ventas-mensuales", { mes: 9, anio: 2026 }, undefined, {
      identity: async () => ({ ok: true, context: ownerContext, payload: {} }),
      session: async () => ({ active: false, reason: "sistema" }),
    });
    expect(result.ok).toBe(false);
  });
});
