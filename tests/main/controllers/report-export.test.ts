import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  createDailySalesExportController,
  createDailySalesPdfBuffer,
  createDailySalesXlsxBuffer,
  renderDailySalesPrintHtml,
  saveDailySalesWithAudit,
  type DailySalesExportDependencies,
} from "../../../src/main/controllers/report-export";
import type { DailySalesReport } from "../../../src/shared/reports";
import { REPORT_EXPORT_ERROR_MESSAGE } from "../../../src/shared/reports";

const report: DailySalesReport = {
  fecha: "2026-06-12", tieneVentas: true,
  ventas: [{ ventaId: "00000000-0000-4000-8000-000000000451", fechaHora: "2026-06-12T17:00:00.000Z", responsable: { usuarioId: "owner", nombre: "Ana Histórica", rol: "dueno" }, estado: "confirmada", metodoPago: "efectivo", total: 2500 }],
  resumen: { ventasVigentes: 1, montoVigente: 2500, porMetodoPago: {
    efectivo: { cantidad: 1, monto: 2500 }, debito: { cantidad: 0, monto: 0 }, credito: { cantidad: 0, monto: 0 }, transferencia: { cantidad: 0, monto: 0 },
  }, ventasAnuladas: 0, montoAnulado: 0 },
  topProductos: [{ productoId: 1, ean13: "7802920000015", nombre: "Pan", unidades: 2, montoNeto: 2500 }],
  caja: { estado: "cerrada", fechaHoraCierre: "2026-06-13T02:00:00.000Z" },
};
const claims = { usuarioId: "owner", rol: "dueno" as const, usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" };

function dependencies(overrides: Partial<DailySalesExportDependencies> = {}): DailySalesExportDependencies {
  return {
    load: vi.fn(async () => report), userName: vi.fn(async () => "Ana Dueña"),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "C:/Documentos/reporte.pdf" })),
    createPdf: vi.fn(async () => Buffer.from("pdf")), createXlsx: vi.fn(async () => Buffer.from("xlsx")),
    saveAndAudit: vi.fn(async () => undefined), documentsPath: () => "C:/Documentos",
    now: () => new Date("2026-09-12T23:30:00.000Z"), ...overrides,
  };
}

describe("CU46 C61 exportación", () => {
  it.each(["pdf", "xlsx"] as const)("recalcula y exporta %s usando identidad de Main", async (format) => {
    const deps = dependencies({ showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: `C:/Documentos/reporte.${format}` })) });
    const controller = createDailySalesExportController(deps);
    const result = await controller.handle({ tipo: "ventas-diarias", fecha: report.fecha, filas: [{ nombre: "falso" }], ruta: "C:/ataque.pdf" }, { channel: `reporte:exportar-${format}`, claims });
    expect(result).toMatchObject({ ok: true, data: { formato: format, estado: "saved", ruta: `C:/Documentos/reporte.${format}` } });
    expect(deps.load).toHaveBeenCalledExactlyOnceWith(report.fecha);
    expect(deps.userName).toHaveBeenCalledExactlyOnceWith("owner");
    expect(deps.saveAndAudit).toHaveBeenCalledWith(`C:/Documentos/reporte.${format}`, expect.any(Buffer), "owner", report.fecha, format);
    expect(format === "pdf" ? deps.createPdf : deps.createXlsx).toHaveBeenCalledWith(expect.objectContaining({ report, usuario: "Ana Dueña" }));
  });

  it("bloquea trabajador, fecha inválida, E1 y cancelación", async () => {
    const deps = dependencies();
    const controller = createDailySalesExportController(deps);
    expect(await controller.handle({ tipo: "ventas-diarias", fecha: report.fecha }, { channel: "reporte:exportar-pdf", claims: { ...claims, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await controller.handle({ tipo: "otro", fecha: report.fecha }, { channel: "reporte:exportar-pdf", claims })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const empty = createDailySalesExportController(dependencies({ load: vi.fn(async () => ({ ...report, tieneVentas: false, ventas: [] })) }));
    expect(await empty.handle({ tipo: "ventas-diarias", fecha: report.fecha }, { channel: "reporte:exportar-pdf", claims })).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE" } });
    const cancelled = dependencies({ showSaveDialog: vi.fn(async () => ({ canceled: true })) });
    expect(await createDailySalesExportController(cancelled).handle({ tipo: "ventas-diarias", fecha: report.fecha }, { channel: "reporte:exportar-pdf", claims })).toMatchObject({ ok: true, data: { estado: "cancelled" } });
    expect(cancelled.saveAndAudit).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
  });

  it.each(["load", "showSaveDialog", "createPdf", "createXlsx", "saveAndAudit"] as const)("devuelve E2 si falla %s", async (stage) => {
    const deps = dependencies({ [stage]: vi.fn(async () => { throw new Error("fallo interno"); }) });
    const result = await createDailySalesExportController(deps).handle({ tipo: "ventas-diarias", fecha: report.fecha }, { channel: stage === "createXlsx" ? "reporte:exportar-xlsx" : "reporte:exportar-pdf", claims });
    expect(result).toMatchObject({ ok: false, error: { code: "TECHNICAL_ERROR", message: REPORT_EXPORT_ERROR_MESSAGE } });
  });

  it("incluye encabezado y todas las secciones en PDF y XLSX", async () => {
    const input = { report, generatedAt: "12-09-2026 20:30", usuario: "Ana Dueña" };
    const html = renderDailySalesPrintHtml(input);
    for (const expected of ["Minimarket y Panadería Huáscar", "Reporte diario de ventas", "12/06/2026", "Ana Dueña", "Pan", "Ana Histórica", "Ventas anuladas", "Estado de caja"]) expect(html).toContain(expected);
    const printToPDF = vi.fn(async () => Buffer.from("%PDF"));
    const destroy = vi.fn();
    await expect(createDailySalesPdfBuffer(input, () => ({ loadURL: vi.fn(async () => undefined), isDestroyed: () => false, destroy, webContents: { printToPDF } }))).resolves.toEqual(Buffer.from("%PDF"));
    expect(printToPDF).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await createDailySalesXlsxBuffer(input)) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const values = workbook.getWorksheet("Ventas diarias")!.getRows(1, 30)!.flatMap((row) => (row.values as (string | number)[]).filter(Boolean)).map(String);
    for (const expected of ["Minimarket y Panadería Huáscar", "Reporte diario de ventas", "Ana Dueña", "Pan", "Ana Histórica", "Ventas anuladas", "Estado de caja"]) expect(values).toContain(expected);
  });

  it("restaura el archivo previo si falla la auditoría", async () => {
    const dir = await mkdtemp(join(tmpdir(), "huascar-cu46-export-"));
    const path = join(dir, "reporte.pdf");
    try {
      await writeFile(path, "anterior");
      await expect(saveDailySalesWithAudit(path, Buffer.from("nuevo"), "owner", report.fecha, "pdf", async () => { throw new Error("audit"); })).rejects.toThrow("audit");
      expect(await readFile(path, "utf8")).toBe("anterior");
      await saveDailySalesWithAudit(path, Buffer.from("nuevo"), "owner", report.fecha, "pdf", async () => undefined);
      expect(await readFile(path, "utf8")).toBe("nuevo");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
