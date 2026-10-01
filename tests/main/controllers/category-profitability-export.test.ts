import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  createCategoryProfitabilityExportHandler, createProfitabilityPdf, createProfitabilityXlsx,
  renderProfitabilityPrintHtml, type ProfitabilityExportDependencies,
} from "../../../src/main/controllers/category-profitability-export";
import { createReportExportController } from "../../../src/main/controllers/report-export";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import type { ControllerContext } from "../../../src/main/controllers/base";
import type { CategoryProfitabilityReport } from "../../../src/shared/category-profitability";

const report: CategoryProfitabilityReport = {
  periodo: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" },
  categorias: [
    { categoriaId: 1, categoriaNombre: "Pan <integral>", unidadesVendidas: 2, costoTotal: 60, ingresoNeto: 199, gananciaPorcentual: 231.67 },
    { categoriaId: 2, categoriaNombre: "Sin costo", unidadesVendidas: 1, costoTotal: 0, ingresoNeto: 100, gananciaPorcentual: null },
  ],
};
const user = { usuarioId: "owner", role: "dueno" as const, usuarioRol: "dueno", trabajadorNombre: "Ana <Dueña>" };
const input = { report, usuario: user.trabajadorNombre, fecha: "30-09-2026 10:00" };
const context: ControllerContext = { channel: "reporte:exportar-pdf", claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" } };
const request = { tipo: "rentabilidad-categoria", periodo: report.periodo };
function dependencies(overrides: Partial<ProfitabilityExportDependencies> = {}): ProfitabilityExportDependencies {
  return {
    load: vi.fn(async () => ({ report, user })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "C:/Documentos/reporte" })),
    pdf: vi.fn(async () => Buffer.from("pdf")), xlsx: vi.fn(async () => Buffer.from("xlsx")),
    save: vi.fn(async () => undefined), now: () => new Date("2026-09-30T13:00:00Z"),
    documentsPath: () => "C:/Documentos", ...overrides,
  };
}

describe("CU51 exportación C61 UI06 UI07", () => {
  it("routes CU46, CU47, CU48, CU51 and legacy exports to their own handlers", async () => {
    const monthly = vi.fn(async () => ({ ok: true as const, data: "monthly" }));
    const products = vi.fn(async () => ({ ok: true as const, data: "products" }));
    const profitability = vi.fn(async () => ({ ok: true as const, data: "profitability" }));
    const legacy = { metadata: createReportExportController().metadata, handle: vi.fn(async () => ({ ok: true as const, data: "legacy" })) };
    const daily = { metadata: legacy.metadata, handle: vi.fn(async () => ({ ok: true as const, data: "daily" })) };
    const controller = createReportExportController(monthly, legacy, products, daily, profitability);
    for (const channel of ["reporte:exportar-pdf", "reporte:exportar-xlsx"]) {
      const ctx = { ...context, channel };
      expect(await controller.handle({ tipo: "ventas-diarias", fecha: "2026-09-30" }, ctx)).toMatchObject({ data: "daily" });
      expect(await controller.handle({ tipo: "ventas-mensuales" }, ctx)).toMatchObject({ data: "monthly" });
      expect(await controller.handle({ tipo: "productos-mas-vendidos" }, ctx)).toMatchObject({ data: "products" });
      expect(await controller.handle(request, ctx)).toMatchObject({ data: "profitability" });
      expect(await controller.handle({}, ctx)).toMatchObject({ data: "legacy" });
      expect(await controller.handle({ tipo: "unknown" }, ctx)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    }
    for (const handler of [monthly, products, profitability, legacy.handle, daily.handle]) expect(handler).toHaveBeenCalledTimes(2);
  });

  it.each(["pdf", "xlsx"] as const)("recalculates %s in Main instead of trusting rows or identity from the renderer", async (format) => {
    const deps = dependencies();
    const ctx = { ...context, channel: `reporte:exportar-${format}` };
    const controller = createReportExportController(undefined, undefined, undefined, undefined, createCategoryProfitabilityExportHandler(deps));
    const audit = vi.fn();
    const result = await handleWithAudit(controller, { ...request, categorias: [], usuario: "Fake", ruta: "Fake" }, ctx, audit);
    expect(deps.load).toHaveBeenCalledExactlyOnceWith(report.periodo, ctx);
    expect(deps[format]).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({ ok: true, data: { estado: "saved", formato: format, cantidadFilas: 2, ruta: `C:/Documentos/reporte.${format}` } });
    expect(deps.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringContaining(`RentabilidadCategoria_2026-09-01_2026-09-30_30-09-2026.${format}`) }));
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tipoAccion: "exportacion", modulo: "reportes", usuarioId: "owner" }));
  });

  it("rejects empty recalculations without opening a save dialog", async () => {
    const deps = dependencies({ load: async () => ({ report: { ...report, categorias: [] }, user }) });
    expect(await createCategoryProfitabilityExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { message: "No fue posible generar el archivo" } });
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("does not save cancelled exports or audit failed exports as successes", async () => {
    for (const fail of [false, true]) {
      const deps = dependencies(fail ? { save: vi.fn(async () => { throw new Error("Disk full"); }) } : { showSaveDialog: async () => ({ canceled: true }) });
      const audit = vi.fn();
      const controller = createReportExportController(undefined, undefined, undefined, undefined, createCategoryProfitabilityExportHandler(deps));
      const result = await handleWithAudit(controller, request, context, audit);
      expect(audit).not.toHaveBeenCalled();
      if (fail) expect(result).toMatchObject({ ok: false, error: { message: "No fue posible generar el archivo" } });
      else {
        expect(result).toMatchObject({ ok: true, data: { estado: "cancelled" } });
        expect(deps.save).not.toHaveBeenCalled();
      }
    }
  });

  it("rejects workers and invalid ranges before loading report data", async () => {
    const deps = dependencies();
    const handler = createCategoryProfitabilityExportHandler(deps);
    expect(await handler(request, { ...context, claims: { ...context.claims!, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await handler({ ...request, periodo: { fechaInicio: "2026-09-30", fechaTermino: "2026-09-01" } }, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(deps.load).not.toHaveBeenCalled();
  });

  it("includes escaped labels, two decimal percentages and N/A in the PDF composition", () => {
    const html = renderProfitabilityPrintHtml(input);
    expect(html).toContain("01/09/2026 al 30/09/2026");
    expect(html).toContain("Ana &lt;Dueña&gt;");
    expect(html).toContain("Pan &lt;integral&gt;");
    expect(html).toContain("231,67 %");
    expect(html).toContain("N/A");
  });

  it("writes numeric CLP and percentage cells, preserving N/A in Excel", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createProfitabilityXlsx(input) as any);
    const sheet = workbook.getWorksheet("Rentabilidad")!;
    expect(sheet.getCell("A1").value).toBe("Minimarket y Panadería Huáscar");
    expect(sheet.getCell("A3").value).toBe("Período: 01/09/2026 al 30/09/2026");
    expect(sheet.getCell("C8").value).toBe(60);
    expect(sheet.getCell("D8").value).toBe(199);
    expect(sheet.getCell("E8").value).toBeCloseTo(2.3167);
    expect(sheet.getCell("E8").numFmt).toBe("0.00%");
    expect(sheet.getCell("E9").value).toBe("N/A");
  });

  it.each([false, true])("closes the hidden PDF window after rendering (failure=%s)", async (fail) => {
    const destroy = vi.fn();
    const result = createProfitabilityPdf(input, () => ({
      loadURL: async () => undefined, isDestroyed: () => false, destroy,
      webContents: { printToPDF: async () => { if (fail) throw new Error("Print failed"); return Buffer.from("pdf"); } },
    }));
    if (fail) await expect(result).rejects.toThrow("Print failed");
    else expect(await result).toEqual(Buffer.from("pdf"));
    expect(destroy).toHaveBeenCalledOnce();
  });
});
