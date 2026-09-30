import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { createMonthlySalesExportHandler, createMonthlySalesPdf, createMonthlySalesXlsx, renderMonthlySalesPrintHtml, type MonthlySalesExportDependencies } from "../../../src/main/controllers/monthly-sales-export";
import { createReportExportController } from "../../../src/main/controllers/report-export";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import type { ControllerContext } from "../../../src/main/controllers/base";
import type { MonthlySalesReport } from "../../../src/shared/monthly-sales";
import { MONTHLY_SALES_EMPTY_MESSAGE, REPORT_EXPORT_ERROR_MESSAGE } from "../../../src/shared/monthly-sales";

const report: MonthlySalesReport = {
  periodo: { mes: 9, anio: 2026 }, transacciones: 1, montoTotal: 2500, montoMesAnterior: 0, variacionPorcentual: null,
  dias: Array.from({ length: 30 }, (_, index) => ({ fecha: `2026-09-${String(index + 1).padStart(2, "0")}`, transacciones: index === 0 ? 1 : 0, monto: index === 0 ? 2500 : 0 })),
  metodos: [{ metodo: "efectivo", transacciones: 1, monto: 2500 }],
};
const user = { usuarioId: "owner", role: "dueno" as const, usuarioRol: "dueno", trabajadorNombre: "Ana <Dueña>" };
const input = { report, usuario: user.trabajadorNombre, fecha: "30-09-2026 10:00" };
const context: ControllerContext = { channel: "reporte:exportar-pdf", claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" } };
const request = { tipo: "ventas-mensuales", periodo: report.periodo };
function dependencies(overrides: Partial<MonthlySalesExportDependencies> = {}): MonthlySalesExportDependencies {
  return {
    load: vi.fn(async () => ({ report, user })), showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "C:/Documentos/reporte" })),
    pdf: vi.fn(async () => Buffer.from("pdf")), xlsx: vi.fn(async () => Buffer.from("xlsx")), save: vi.fn(async () => undefined),
    now: () => new Date("2026-09-30T13:00:00Z"), documentsPath: () => "C:/Documentos", ...overrides,
  };
}

describe("CU47 monthly export and CU54 compatibility", () => {
  it.each(["pdf", "xlsx"] as const)("recalculates in Main and saves %s without trusting renderer data", async (format) => {
    const deps = dependencies();
    const ctx = { ...context, channel: `reporte:exportar-${format}` };
    const result = await createMonthlySalesExportHandler(deps)({ ...request, dias: [{ monto: 999999 }], usuario: "Fake", ruta: "Fake" }, ctx);
    expect(deps.load).toHaveBeenCalledWith(report.periodo, ctx);
    expect(deps[format]).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({ ok: true, data: { estado: "saved", formato: format, cantidadFilas: 30, ruta: `C:/Documentos/reporte.${format}` } });
    expect(deps.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringContaining(`VentasMensuales_2026-09_30-09-2026.${format}`) }));
  });

  it("rejects empty recalculations even if the renderer claims there is data", async () => {
    const deps = dependencies({ load: async () => ({ report: { ...report, transacciones: 0 }, user }) });
    expect(await createMonthlySalesExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("does not audit a cancelled or failed export as successful", async () => {
    for (const fail of [false, true]) {
      const deps = fail ? dependencies({ save: async () => { throw new Error("Disk full"); } }) : dependencies({ showSaveDialog: async () => ({ canceled: true }) });
      const audit = vi.fn();
      const controller = createReportExportController(createMonthlySalesExportHandler(deps));
      const result = await handleWithAudit(controller, request, context, audit);
      expect(audit).not.toHaveBeenCalled();
      if (fail) expect(result).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
      else expect(result).toMatchObject({ ok: true, data: { estado: "cancelled" } });
    }
  });

  it("audits the saved report once under Reportes", async () => {
    const audit = vi.fn();
    await handleWithAudit(createReportExportController(createMonthlySalesExportHandler(dependencies())), request, context, audit);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tipoAccion: "exportacion", modulo: "reportes", usuarioId: "owner" }));
  });

  it("dispatches daily exports separately and rejects unknown report types", async () => {
    const daily = { metadata: createReportExportController().metadata, handle: vi.fn(async () => ({ ok: true as const, data: "daily" })) };
    const controller = createReportExportController(createMonthlySalesExportHandler(dependencies()), daily);
    expect(await controller.handle({ tipo: "ventas-diarias", fecha: "2026-09-30" }, context)).toEqual({ ok: true, data: "daily" });
    expect(await controller.handle({ tipo: "unknown" }, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(daily.handle).toHaveBeenCalledTimes(1);
  });

  it("rejects workers before looking up data", async () => {
    const deps = dependencies();
    expect(await createMonthlySalesExportHandler(deps)(request, { ...context, claims: { ...context.claims!, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(deps.load).not.toHaveBeenCalled();
  });

  it("includes the chart as an image, all days and escaped identity in print HTML", () => {
    const html = renderMonthlySalesPrintHtml(input);
    expect(html).toContain('src="data:image/svg+xml');
    expect(html).toContain("30/09/2026");
    expect(html).toContain("Ana &lt;Dueña&gt;");
    expect(html).toContain("N/A");
    expect(html).not.toContain(MONTHLY_SALES_EMPTY_MESSAGE);
  });

  it("creates a workbook with all daily values, payment methods and no embedded image", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createMonthlySalesXlsx(input) as any);
    const sheet = workbook.getWorksheet("Ventas mensuales")!;
    expect(sheet.getCell("A1").value).toBe("Minimarket y Panadería Huáscar");
    expect(sheet.getCell("C6").value).toBe(2500);
    expect(sheet.getCell("C8").value).toBe("N/A");
    expect(sheet.getCell("A11").value).toBe("01/09/2026");
    expect(sheet.getCell("C12").value).toBe(0);
    expect(sheet.getCell("A40").value).toBe("30/09/2026");
    expect(sheet.getImages()).toEqual([]);
  });

  it("closes its hidden PDF window on rendering failure", async () => {
    const destroy = vi.fn();
    await expect(createMonthlySalesPdf(input, () => ({ loadURL: async () => undefined, isDestroyed: () => false, destroy, webContents: { printToPDF: async () => { throw new Error("Print failed"); } } }))).rejects.toThrow("Print failed");
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
