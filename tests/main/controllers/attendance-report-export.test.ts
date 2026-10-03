import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  createAttendancePdf, createAttendanceReportExportHandler, createAttendanceXlsx,
  renderAttendancePrintHtml, type AttendanceExportDependencies,
} from "../../../src/main/controllers/attendance-report-export";
import { createReportExportController } from "../../../src/main/controllers/report-export";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { guardChannel } from "../../../src/main/controllers/auth-guard";
import { MonthlyAttendanceError } from "../../../src/main/controllers/monthly-attendance-calculation";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { REPORT_EXPORT_ERROR_MESSAGE } from "../../../src/shared/monthly-sales";
import type { AttendanceReport } from "../../../src/shared/attendance-report";
import type { ControllerContext } from "../../../src/main/controllers/base";

const report: AttendanceReport = { periodo: { mes: 9, anio: 2026 }, rol: "trabajador", filas: [
  { trabajadorId: 2, nombreCompleto: "Luis <Rojas>", rol: "trabajador", diasTrabajados: 3, ausenciasJustificadas: 1, ausenciasInjustificadas: 2, minutosTrabajados: 6001, promedioMinutosPorDia: 2000 },
  { trabajadorId: 3, nombreCompleto: "Inés Pérez", rol: null, diasTrabajados: 0, ausenciasJustificadas: 1, ausenciasInjustificadas: 0, minutosTrabajados: 0, promedioMinutosPorDia: null },
] };
const user = { role: "dueno" as const, usuarioId: "owner", usuarioRol: "dueno", trabajadorNombre: "Ana <Soto>" };
const request = { tipo: "asistencia-personal", periodo: report.periodo, rol: "trabajador" };
const context: ControllerContext = { channel: "reporte:exportar-pdf", claims: { usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" } };
const printInput = { report, usuario: user.trabajadorNombre, fecha: "30-09-2026 10:00" };
function dependencies(overrides: Partial<AttendanceExportDependencies> = {}): AttendanceExportDependencies {
  return {
    load: vi.fn(async () => ({ report, user })), showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "C:/Documentos/reporte" })),
    pdf: vi.fn(async () => Buffer.from("pdf")), xlsx: vi.fn(async () => Buffer.from("xlsx")), save: vi.fn(async () => undefined),
    now: () => new Date("2026-09-30T13:00:00Z"), documentsPath: () => "C:/Documentos", ...overrides,
  };
}
const controller = (deps: AttendanceExportDependencies) => createReportExportController(undefined, undefined, undefined, undefined, undefined, createAttendanceReportExportHandler(deps));

describe("CU52 export through C61", () => {
  it.each(["pdf", "xlsx"] as const)("recalculates filtered %s in Main and audits the saved file once", async (format) => {
    const deps = dependencies();
    const audit = vi.fn();
    const ctx = { ...context, channel: `reporte:exportar-${format}` };
    const result = await handleWithAudit(controller(deps), { ...request, filas: [{ nombreCompleto: "Fake" }], usuario: "Fake", ruta: "Fake" }, ctx, audit);
    expect(deps.load).toHaveBeenCalledExactlyOnceWith({ ...report.periodo, rol: "trabajador" }, ctx);
    expect(deps[format]).toHaveBeenCalledExactlyOnceWith(printInput);
    expect(result).toMatchObject({ ok: true, data: { estado: "saved", formato: format, cantidadFilas: 2, ruta: `C:/Documentos/reporte.${format}` } });
    expect(deps.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringContaining(`AsistenciaPersonal_2026-09_30-09-2026.${format}`) }));
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tipoAccion: "exportacion", modulo: "reportes", usuarioId: "owner" }));
  });
  it("supports Todos and refuses empty recalculation without opening a save dialog", async () => {
    const deps = dependencies({ load: vi.fn(async () => ({ report: { ...report, rol: null, filas: [] }, user })) });
    expect(await createAttendanceReportExportHandler(deps)({ tipo: request.tipo, periodo: request.periodo, filas: report.filas }, context)).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
    expect(deps.load).toHaveBeenCalledExactlyOnceWith(report.periodo, context);
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("does not save or audit cancelled exports", async () => {
    const deps = dependencies({ showSaveDialog: async () => ({ canceled: true }) });
    const audit = vi.fn();
    expect(await handleWithAudit(controller(deps), request, context, audit)).toMatchObject({ ok: true, data: { estado: "cancelled" } });
    expect(deps.pdf).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it.each(["pdf", "xlsx", "save", "load"] as const)("reports %s failures with the required message and no successful audit", async (stage) => {
    const deps = dependencies({ [stage]: async () => { throw new MonthlyAttendanceError("BUSINESS_RULE", "Origin inconsistent"); } });
    const audit = vi.fn();
    expect(await handleWithAudit(controller(deps), request, { ...context, channel: stage === "xlsx" ? "reporte:exportar-xlsx" : context.channel }, audit)).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
    expect(audit).not.toHaveBeenCalled();
    if (stage !== "save") expect(deps.save).not.toHaveBeenCalled();
  });
  it("rejects unauthorized callers and invalid type, period, role and channel before querying", async () => {
    const deps = dependencies();
    const handler = createAttendanceReportExportHandler(deps);
    expect(await handler(request, { ...context, claims: { ...context.claims!, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await guardChannel(context.channel, request, { verifyToken: () => ({ ...context.claims!, rol: "trabajador" }), audit: async () => undefined })).ok).toBe(false);
    expect(await handler(request, { ...context, channel: "reporte:asistencia" })).toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
    for (const payload of [{ ...request, tipo: "other" }, { ...request, periodo: { mes: 0, anio: 2026 } }, { ...request, rol: "other" }]) {
      expect(await handler(payload, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    }
    expect(deps.load).not.toHaveBeenCalled();
    expect(await createAttendanceReportExportHandler(dependencies({ load: async () => { throw new AccessDeniedError(); } }))(request, context)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("renders all seven columns with institutional headings, filter and escaped identity", () => {
    const html = renderAttendancePrintHtml(printInput);
    for (const value of ["Minimarket y Panadería Huáscar", "septiembre de 2026", "Rol: Trabajador", "30-09-2026", "Ana &lt;Soto&gt;", "Luis &lt;Rojas&gt;", "100:01", "33:20", "N/A", "Sin usuario"]) expect(html).toContain(value);
    expect(html.match(/<th /g)).toHaveLength(7);
    expect(html).toContain("A4 landscape");
  });
  it("writes actual XLSX rows with numeric counts and matching HH:MM/N/A", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createAttendanceXlsx(printInput) as any);
    const sheet = workbook.getWorksheet("Asistencia")!;
    expect(sheet.getCell("A1").value).toBe("Minimarket y Panadería Huáscar");
    expect(sheet.getCell("A4").value).toBe("Rol: Trabajador");
    expect(sheet.getCell("A6").value).toBe("Usuario: Ana <Soto>");
    expect(sheet.getCell("A9").value).toBe("Luis <Rojas>");
    expect(sheet.getCell("C9").value).toBe(3);
    expect(sheet.getCell("F9").value).toBe("100:01");
    expect(sheet.getCell("G9").value).toBe("33:20");
    expect(sheet.getCell("B10").value).toBe("Sin usuario");
    expect(sheet.getCell("G10").value).toBe("N/A");
  });
  it.each([false, true])("prints landscape PDF and closes its hidden window (failure=%s)", async (fail) => {
    const destroy = vi.fn();
    const printToPDF = vi.fn(async () => { if (fail) throw Error("Print failed"); return Buffer.from("pdf"); });
    const window = { loadURL: vi.fn(async () => undefined), isDestroyed: () => false, destroy, webContents: { printToPDF } };
    const result = createAttendancePdf(printInput, () => window);
    if (fail) await expect(result).rejects.toThrow("Print failed");
    else expect(await result).toEqual(Buffer.from("pdf"));
    expect(printToPDF).toHaveBeenCalledWith(expect.objectContaining({ landscape: true, pageSize: "A4" }));
    expect(destroy).toHaveBeenCalledOnce();
  });
});
