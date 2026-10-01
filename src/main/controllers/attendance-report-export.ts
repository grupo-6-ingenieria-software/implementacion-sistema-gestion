import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ATTENDANCE_REPORT_TYPE, attendanceFilterLabel, attendanceReportColumns, attendanceReportValues,
  parseAttendanceReportRequest,
} from "../../shared/attendance-report";
import { monthlyPeriodKey, monthlyPeriodLabel, parseMonthlySalesPeriod, REPORT_EXPORT_ERROR_MESSAGE, type ReportExportResult } from "../../shared/monthly-sales";
import { ReporteAsistenciaPrintView, type AttendancePrintInput } from "../../renderer/src/components/ReporteAsistenciaPrintView";
import { AccessDeniedError } from "./auth-context";
import { loadAuthorizedAttendanceReport } from "./attendance-report";
import { controllerError, controllerSuccess, type ControllerHandler } from "./base";
import { ensureExportExtension, formatDateTimeInSantiago, type HiddenPrintWindow } from "./restock-report-export";

export type AttendanceExportDependencies = {
  load: typeof loadAuthorizedAttendanceReport;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;
  pdf: (input: AttendancePrintInput) => Promise<Buffer>;
  xlsx: (input: AttendancePrintInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
};

export function createAttendanceReportExportHandler(deps: AttendanceExportDependencies = defaults): ControllerHandler<unknown, ReportExportResult> {
  return async (payload, context) => {
    if (context.claims?.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.");
    const format = context.channel === "reporte:exportar-pdf" ? "pdf" : context.channel === "reporte:exportar-xlsx" ? "xlsx" : null;
    if (!format) return controllerError("INVALID_CHANNEL", "Formato de exportación no válido.");
    try {
      const input = payload as { tipo?: unknown; periodo?: unknown; rol?: unknown } | null;
      if (input?.tipo !== ATTENDANCE_REPORT_TYPE) return controllerError("VALIDATION_ERROR", "Tipo de reporte no válido.");
      const request = parseAttendanceReportRequest({ ...parseMonthlySalesPeriod(input.periodo), rol: input.rol });
      const { report, user } = await deps.load(request, context);
      if (report.filas.length === 0) return controllerError("BUSINESS_RULE", REPORT_EXPORT_ERROR_MESSAGE);
      const now = deps.now();
      const fecha = formatDateTimeInSantiago(now);
      const selected = await deps.showSaveDialog({
        title: "Guardar reporte de asistencia del personal",
        defaultPath: join(deps.documentsPath(), `AsistenciaPersonal_${monthlyPeriodKey(report.periodo)}_${fecha.slice(0, 10)}.${format}`),
        filters: [{ name: format === "pdf" ? "Documento PDF" : "Libro de Excel", extensions: [format] }],
      });
      const result = { formato: format, cantidadFilas: report.filas.length, fechaGeneracion: now.toISOString() } as const;
      if (selected.canceled || !selected.filePath) return controllerSuccess({ ...result, estado: "cancelled" });
      const printInput = { report, usuario: user.trabajadorNombre, fecha };
      const contents = await (format === "pdf" ? deps.pdf(printInput) : deps.xlsx(printInput));
      const path = ensureExportExtension(selected.filePath, format);
      await deps.save(path, contents);
      return controllerSuccess({ ...result, estado: "saved", ruta: path });
    } catch (error) {
      if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message);
      if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message);
      log.error("[attendance-report-export]", error);
      return controllerError("TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE);
    }
  };
}

export function renderAttendancePrintHtml(input: AttendancePrintInput): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Asistencia del personal</title><style>
    @page { size: A4 landscape; margin: 12mm; } body { font: 10pt Arial, sans-serif; color: #17202a; }
    h1 { font-size: 18pt; color: #1b4332; } h2 { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; }
    tr { break-inside: avoid; } th,td { padding: 6px; border: 1px solid #cbd5df; text-align: right; overflow-wrap: anywhere; }
    th:nth-child(-n+2),td:nth-child(-n+2) { text-align: left; } th { background: #edf7f1; }
    </style></head><body>${renderToStaticMarkup(createElement(ReporteAsistenciaPrintView, input))}</body></html>`;
}

export async function createAttendancePdf(input: AttendancePrintInput, createWindow: () => HiddenPrintWindow = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })): Promise<Buffer> {
  const window = createWindow();
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderAttendancePrintHtml(input))}`);
    return await window.webContents.printToPDF({ landscape: true, pageSize: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function createAttendanceXlsx({ report, usuario, fecha }: AttendancePrintInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = usuario;
  const sheet = workbook.addWorksheet("Asistencia", { views: [{ state: "frozen", ySplit: 8 }] });
  const headings = ["Minimarket y Panadería Huáscar", "Reporte de asistencia del personal",
    `Período: ${monthlyPeriodLabel(report.periodo)}`, `Rol: ${attendanceFilterLabel(report.rol)}`, `Generado: ${fecha}`, `Usuario: ${usuario}`];
  headings.forEach((text, index) => { sheet.mergeCells(index + 1, 1, index + 1, 7); sheet.getCell(index + 1, 1).value = text; });
  sheet.addRow([]);
  sheet.addRow([...attendanceReportColumns]);
  for (const row of report.filas) sheet.addRow(attendanceReportValues(row));
  sheet.columns.forEach((column, index) => { column.width = index === 0 ? 32 : index === 6 ? 30 : 24; });
  for (const number of [1, 2, 8]) {
    const row = sheet.getRow(number);
    row.font = { bold: true, color: { argb: "FF1B4332" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF7F1" } };
  }
  sheet.autoFilter = `A8:G${8 + report.filas.length}`;
  sheet.addRow([]);
  sheet.addRow(["El promedio considera únicamente jornadas con salida. Las jornadas pendientes cuentan como días trabajados."]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const defaults: AttendanceExportDependencies = {
  load: loadAuthorizedAttendanceReport,
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  pdf: createAttendancePdf, xlsx: createAttendanceXlsx,
  save: (path, contents) => writeFile(path, contents), now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
};
