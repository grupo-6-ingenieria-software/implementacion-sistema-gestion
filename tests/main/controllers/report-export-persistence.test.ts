import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { authorizeUser } from "../../../src/main/controllers/auth-context";
import { createReportAuditStorage } from "../../../src/main/controllers/report-export-audit";
import { createReportExportHandler } from "../../../src/main/controllers/report-export-service";
import { createMonthlySalesReportAdapter, createReportRegistry } from "../../../src/main/controllers/report-registry";
import { createMonthlySalesXlsx } from "../../../src/main/controllers/monthly-sales-export";
import { queryMonthlySales } from "../../../src/main/controllers/monthly-sales";
import type { MonthlySalesPeriod } from "../../../src/shared/monthly-sales";
import { REPORT_RECONCILE_CHANNEL } from "../../../src/shared/reports";
import { context, reportDependencies, request } from "./report-export-fixture";
import { seedInventoryExport } from "./inventory-export-fixture";

let fixture: AuthTestDatabase;
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, { usuarioId: "owner", trabajadorId: 1, rut: "11111111-1", nombre: "Ana", apellido: "Dueña" });
  await seedInventoryExport(fixture);
  await fixture.client.executeMultiple(await readFile("src/db/triggers.sql", "utf8"));
  const [cash] = await fixture.db.insert(schema.cierreCaja).values({ cierreFechaHoraInicio: "2026-09-01T04:00:00Z" }).returning();
  const [price] = await fixture.db.select().from(schema.historialPrecioProducto).where(eq(schema.historialPrecioProducto.productoId, 1));
  const [sale] = await fixture.db.insert(schema.venta).values({
    ventaFechaHora: "2026-09-15T13:00:00Z", ventaMetodoPago: "efectivo", esVentaEfectivo: true, esVentaElectronica: false,
    usuarioCajeroId: "owner", ventaResponsableNombre: "Responsable histórico", ventaResponsableRol: "dueno", cierreCajaId: cash.cierreCajaId,
  }).returning();
  await fixture.db.insert(schema.detalleVenta).values({ ventaId: sale.ventaId, productoId: 1, detalleVentaCantidad: 1, historialPrecioProductoId: price.historialPrecioProductoId });
});
afterEach(async () => { fixture.client.close(); await removeAuthTempDir(fixture.dir); });
const filename = "VentasMensuales_2026-09_30-09-2026.xlsx";
const ctx = { ...context, channel: "reporte:exportar-xlsx" };
const verifyCtx = { ...context, channel: REPORT_RECONCILE_CHANNEL };

function dependencies() {
  return reportDependencies(fixture.dir, {
    audit: createReportAuditStorage(fixture.db),
    registry: createReportRegistry([createMonthlySalesReportAdapter(async (period, context) => ({
      user: await authorizeUser(fixture.db, schema, context.claims?.usuarioId, ["dueno"], context.claims?.rol),
      report: await queryMonthlySales(fixture.db, period as MonthlySalesPeriod),
    }), undefined, createMonthlySalesXlsx)]),
  });
}
async function snapshot() {
  return Promise.all([fixture.db.select().from(schema.venta), fixture.db.select().from(schema.detalleVenta),
    fixture.db.select().from(schema.producto), fixture.db.select().from(schema.lote), fixture.db.select().from(schema.historialPrecioProducto), fixture.db.select().from(schema.cierreCaja)]);
}

describe("CU54 real database transactions and immutable audit", () => {
  it("rejects an inactive owner before reading report data, opening a dialog or writing an audit", async () => {
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" }).where(eq(schema.trabajador.trabajadorId, 1));
    const deps = dependencies(); const dialog = vi.spyOn(deps, "selectDirectory"); const before = await snapshot();
    expect(await createReportExportHandler(deps)(request, ctx)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(dialog).not.toHaveBeenCalled();
    expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([]);
    expect(await fixture.db.select().from(schema.usuarioVersion)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
  it("recalculates after screen generation, exports historical prices and writes only one audit/version", async () => {
    const screen = await queryMonthlySales(fixture.db, request.periodo);
    const [line] = await fixture.db.select().from(schema.detalleVenta);
    await fixture.db.update(schema.detalleVenta).set({ detalleVentaCantidad: 2 }).where(eq(schema.detalleVenta.detalleVentaId, line.detalleVentaId));
    const before = await snapshot();
    expect(await createReportExportHandler(dependencies())({ ...request, filas: screen.dias, usuarioId: "fake" }, ctx)).toMatchObject({ ok: true, data: { estado: "saved" } });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(join(fixture.dir, filename)) as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet("Ventas mensuales")!.getCell("C6").value).toBe(screen.montoTotal * 2);
    const logs = await fixture.db.select().from(schema.logAuditoria); const versions = await fixture.db.select().from(schema.usuarioVersion);
    expect(logs).toHaveLength(1); expect(versions).toHaveLength(1);
    expect(logs[0]).toMatchObject({ logModulo: "reportes", logTipoAccion: "exportacion", usuarioVersionId: versions[0].usuarioVersionId, logFechaHora: "2026-09-30T10:00:00.000-03:00" });
    expect(versions[0]).toMatchObject({ usuarioId: "owner", usuarioVersionNombre: "Ana Dueña" });
    expect(await snapshot()).toEqual(before);
    await expect(fixture.db.delete(schema.logAuditoria).where(eq(schema.logAuditoria.logAuditoriaId, logs[0].logAuditoriaId))).rejects.toThrow();
    await expect(fixture.db.update(schema.logAuditoria).set({ logDescripcion: "altered" })).rejects.toThrow();
  });
  it("rolls back the newly created identity version when audit insertion fails and preserves existing file", async () => {
    await writeFile(join(fixture.dir, filename), "original"); const before = await snapshot();
    await fixture.db.run(sql`CREATE TRIGGER fail_report_audit BEFORE INSERT ON log_auditoria BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`);
    expect(await createReportExportHandler(dependencies())(request, ctx)).toMatchObject({ ok: false, error: { message: "No fue posible generar el archivo" } });
    expect(await readFile(join(fixture.dir, filename), "utf8")).toBe("original");
    expect(await fixture.db.select().from(schema.usuarioVersion)).toEqual([]); expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([]);
    expect(await snapshot()).toEqual(before); expect(await readdir(join(fixture.dir, "evidence"))).toEqual([]);
  });
  it("rolls back identity, audit and publication if the filesystem fails inside the real transaction", async () => {
    await writeFile(join(fixture.dir, filename), "original"); const deps = dependencies();
    vi.spyOn(deps.files, "publish").mockRejectedValue(new Error("publish failure"));
    expect(await createReportExportHandler(deps)(request, ctx)).toMatchObject({ ok: false });
    expect(await fixture.db.select().from(schema.usuarioVersion)).toEqual([]); expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([]);
    expect(await readFile(join(fixture.dir, filename), "utf8")).toBe("original");
  });
  it.each([true, false])("resolves lost COMMIT acknowledgement with committed=%s using the original audit ID", async (committed) => {
    await writeFile(join(fixture.dir, filename), "original"); const deps = dependencies();
    const real = deps.audit;
    deps.audit = createReportAuditStorage({ transaction: async (callback) => {
      if (committed) { await fixture.db.transaction(callback); throw new Error("lost acknowledgement"); }
      return fixture.db.transaction(async (tx) => { await callback(tx); throw new Error("lost acknowledgement before commit"); });
    } });
    const handler = createReportExportHandler(deps); const result = await handler(request, ctx);
    expect(result).toMatchObject({ ok: false, error: { code: "EXPORT_RECONCILIATION_REQUIRED" } });
    if (result.ok) throw new Error("Expected pending");
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(committed ? 1 : 0);
    deps.audit = real;
    expect(await handler({ operacionId: result.error.operacionId }, verifyCtx)).toMatchObject({ ok: true, data: { estado: committed ? "saved" : "reverted" } });
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(committed ? 1 : 0);
    expect(await fixture.db.select().from(schema.usuarioVersion)).toHaveLength(committed ? 1 : 0);
    if (!committed) expect(await readFile(join(fixture.dir, filename), "utf8")).toBe("original");
    expect(await readdir(join(fixture.dir, "evidence"))).toEqual([]);
  });
  it("compensates an explicit SQL COMMIT rejection without classifying it as a transport ambiguity", async () => {
    await writeFile(join(fixture.dir, filename), "original"); const deps = dependencies();
    deps.audit = createReportAuditStorage({ transaction: (callback) => fixture.db.transaction(async (tx) => {
      await callback(tx); throw Object.assign(new Error("deferred constraint"), { code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
    }) });
    expect(await createReportExportHandler(deps)(request, ctx)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([]); expect(await fixture.db.select().from(schema.usuarioVersion)).toEqual([]);
    expect(await readFile(join(fixture.dir, filename), "utf8")).toBe("original");
    expect(await readdir(join(fixture.dir, "evidence"))).toEqual([]);
  });
});
