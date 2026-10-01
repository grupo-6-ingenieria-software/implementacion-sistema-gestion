import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  createProductsMostSoldExportHandler,
  createProductsMostSoldPdf,
  createProductsMostSoldXlsx,
  renderProductsMostSoldPrintHtml,
  type ProductsMostSoldExportDependencies,
} from "../../../src/main/controllers/products-most-sold-export";
import { createReportExportController } from "../../../src/main/controllers/report-export";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { REPORT_EXPORT_ERROR_MESSAGE } from "../../../src/shared/monthly-sales";
import type { ProductsMostSoldReport } from "../../../src/shared/products-most-sold";
import type { ControllerContext } from "../../../src/main/controllers/base";
import { guardChannel } from "../../../src/main/controllers/auth-guard";

const report: ProductsMostSoldReport = {
  status: "ready", periodo: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" }, totalUnidadesPeriodo: 3,
  filas: [
    { productoId: 1, ean13: "0000000000001", nombre: "Marraqueta", categoria: "Pan", unidadesVendidas: 2, ingresoNeto: 1800, porcentajeUnidades: 200 / 3 },
    { productoId: 2, ean13: "0000000000002", nombre: "Jugo", categoria: "Bebidas", unidadesVendidas: 1, ingresoNeto: 900, porcentajeUnidades: 100 / 3 },
  ],
};
const user = { usuarioId: "owner", role: "dueno" as const, usuarioRol: "dueno", trabajadorNombre: "Ana <Dueña>" };
const input = { report, usuario: user.trabajadorNombre, fecha: "30-09-2026 10:00" };
const context: ControllerContext = { channel: "reporte:exportar-pdf", claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" } };
const request = { tipo: "productos-mas-vendidos", periodo: report.periodo };

function dependencies(overrides: Partial<ProductsMostSoldExportDependencies> = {}): ProductsMostSoldExportDependencies {
  return {
    load: vi.fn(async () => ({ report, user })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "C:/Documentos/reporte" })),
    pdf: vi.fn(async () => Buffer.from("pdf")), xlsx: vi.fn(async () => Buffer.from("xlsx")),
    save: vi.fn(async () => undefined), now: () => new Date("2026-09-30T13:00:00Z"), documentsPath: () => "C:/Documentos", ...overrides,
  };
}

describe("CU48 PDF/XLSX export", () => {
  it.each(["pdf", "xlsx"] as const)("recalculates in Main, ignores renderer rows and saves %s", async (format) => {
    const deps = dependencies();
    const ctx = { ...context, channel: `reporte:exportar-${format}` };
    const result = await createProductsMostSoldExportHandler(deps)({ ...request, filas: [{ ingresoNeto: 999999 }], usuario: "Fake", ruta: "Fake" }, ctx);
    expect(deps.load).toHaveBeenCalledWith(report.periodo, ctx);
    expect(deps[format]).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({ ok: true, data: { estado: "saved", formato: format, cantidadFilas: 2, ruta: `C:/Documentos/reporte.${format}` } });
    expect(deps.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringContaining(`ProductosMasVendidos_2026-09-01_a_2026-09-30_30-09-2026.${format}`) }));
  });

  it.each(["pdf", "xlsx"] as const)("routes daily, monthly, CU48 and inventory exports through %s", async (format) => {
    const monthly = vi.fn(async () => ({ ok: true as const, data: "monthly" }));
    const legacy = { metadata: createReportExportController().metadata, handle: vi.fn(async () => ({ ok: true as const, data: "legacy" })) };
    const products = vi.fn(async () => ({ ok: true as const, data: "products" }));
    const daily = { metadata: createReportExportController().metadata, handle: vi.fn(async () => ({ ok: true as const, data: "daily" })) };
    const controller = createReportExportController(monthly, legacy, products, daily);
    const ctx = { ...context, channel: `reporte:exportar-${format}` };
    expect(controller.metadata).toMatchObject({ id: "report-export", module: "reportes", channels: ["reporte:exportar-pdf", "reporte:exportar-xlsx"] });
    expect(await controller.handle(request, ctx)).toMatchObject({ data: "products" });
    expect(await controller.handle({ tipo: "ventas-mensuales" }, ctx)).toMatchObject({ data: "monthly" });
    expect(await controller.handle({ tipo: "ventas-diarias", fecha: "2026-09-30" }, ctx)).toMatchObject({ data: "daily" });
    expect(await controller.handle({}, ctx)).toMatchObject({ data: "legacy" });
    for (const tipoReporte of ["mermas", "lotes-por-vencer", "movimientos-inventario"]) {
      const payload = { tipoReporte, tipo: "venta", fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" };
      expect(await controller.handle(payload, ctx)).toMatchObject({ data: "legacy" });
      expect(legacy.handle).toHaveBeenLastCalledWith(payload, ctx);
    }
    expect(await controller.handle({ tipo: "unknown" }, ctx)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await controller.handle(request, { ...ctx, channel: "reporte:ventas-diarias" })).toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
    expect(products).toHaveBeenCalledTimes(1);
    expect(monthly).toHaveBeenCalledTimes(1);
    expect(daily.handle).toHaveBeenCalledTimes(1);
    expect(legacy.handle).toHaveBeenCalledTimes(4);
  });

  it("denies workers and invalid periods before recalculating", async () => {
    const deps = dependencies();
    const handler = createProductsMostSoldExportHandler(deps);
    expect(await handler(request, { ...context, claims: { ...context.claims!, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await handler({ ...request, periodo: { fechaInicio: "2026-10-01", fechaTermino: "2026-09-30" } }, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(deps.load).not.toHaveBeenCalled();
    const audit = vi.fn(async () => undefined);
    const direct = await guardChannel("reporte:exportar-pdf", { ...request, __authToken: "x" }, {
      verifyToken: () => ({ ...context.claims!, rol: "trabajador" }), audit,
    });
    expect(direct.ok).toBe(false);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("does not save or audit empty, cancelled, or failed exports", async () => {
    for (const variant of ["empty", "cancel", "error"] as const) {
      const deps = dependencies(variant === "empty"
        ? { load: async () => ({ report: { ...report, status: "empty", filas: [], totalUnidadesPeriodo: 0 }, user }) }
        : variant === "cancel" ? { showSaveDialog: async () => ({ canceled: true }) }
        : { save: async () => { throw new Error("Disk full"); } });
      const audit = vi.fn(async () => undefined);
      const controller = createReportExportController(undefined, undefined, createProductsMostSoldExportHandler(deps));
      const result = await handleWithAudit(controller, request, context, audit);
      expect(audit).not.toHaveBeenCalled();
      if (variant === "cancel") expect(result).toMatchObject({ ok: true, data: { estado: "cancelled" } });
      else expect(result).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
    }
  });

  it("audits exactly one successfully saved CU48 export", async () => {
    const audit = vi.fn(async () => undefined);
    const controller = createReportExportController(undefined, undefined, createProductsMostSoldExportHandler(dependencies()));
    expect(await handleWithAudit(controller, request, context, audit)).toMatchObject({ ok: true, data: { estado: "saved" } });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tipoAccion: "exportacion", modulo: "reportes", usuarioId: "owner" }));
  });

  it("renders escaped PDF contents with six columns and two decimal percentages", () => {
    const html = renderProductsMostSoldPrintHtml(input);
    expect(html).toContain("Reporte de productos más vendidos");
    expect(html).toContain("01/09/2026 al 30/09/2026");
    expect(html).toContain("Ana &lt;Dueña&gt;");
    expect(html).toContain("66,67 %");
    expect(html).toContain("Ingreso neto");
    expect(html).toContain("0000000000001");
  });

  it("writes numeric CLP and percentage cells into the XLSX", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createProductsMostSoldXlsx(input) as any);
    const sheet = workbook.getWorksheet("Productos más vendidos")!;
    expect(sheet.getCell("A1").value).toBe("Minimarket y Panadería Huáscar");
    expect(sheet.getCell("A3").value).toBe("Período: 01/09/2026 al 30/09/2026");
    expect(sheet.getCell("B6").value).toBe(3);
    expect(sheet.getCell("A7").value).toBe("EAN");
    expect(sheet.getCell("E8").value).toBe(1800);
    expect(sheet.getCell("F8").value).toBeCloseTo(2 / 3);
    expect(sheet.getCell("F8").numFmt).toBe("0.00%");
  });

  it("closes its hidden PDF window after printing failure", async () => {
    const destroy = vi.fn();
    await expect(createProductsMostSoldPdf(input, () => ({ loadURL: async () => undefined, isDestroyed: () => false, destroy, webContents: { printToPDF: async () => { throw new Error("Print failed"); } } }))).rejects.toThrow("Print failed");
    expect(destroy).toHaveBeenCalledOnce();
  });
});
