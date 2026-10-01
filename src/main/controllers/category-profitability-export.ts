import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CATEGORY_PROFITABILITY_REPORT_TYPE, parseProfitabilityPeriod, profitabilityPeriodLabel } from "../../shared/category-profitability";
import { REPORT_EXPORT_ERROR_MESSAGE, type ReportExportResult } from "../../shared/monthly-sales";
import { ReporteRentabilidadPrintView, type ProfitabilityPrintInput } from "../../renderer/src/components/ReporteRentabilidadPrintView";
import { AccessDeniedError } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerHandler } from "./base";
import { loadAuthorizedCategoryProfitability } from "./category-profitability";
import { ensureExportExtension, formatDateTimeInSantiago, type HiddenPrintWindow } from "./restock-report-export";

export type ProfitabilityExportDependencies = {
  load: typeof loadAuthorizedCategoryProfitability;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;
  pdf: (input: ProfitabilityPrintInput) => Promise<Buffer>;
  xlsx: (input: ProfitabilityPrintInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
};

export function createCategoryProfitabilityExportHandler(deps: ProfitabilityExportDependencies = defaults): ControllerHandler<unknown, ReportExportResult> {
  return async (payload, context) => {
    if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.");
    const format = context.channel === "reporte:exportar-pdf" ? "pdf" : context.channel === "reporte:exportar-xlsx" ? "xlsx" : null;
    if (!format) return controllerError("INVALID_CHANNEL", "Formato de exportación no válido.");
    try {
      const request = payload as { tipo?: unknown; periodo?: unknown } | null;
      if (request?.tipo !== CATEGORY_PROFITABILITY_REPORT_TYPE) return controllerError("VALIDATION_ERROR", "Tipo de reporte no válido.");
      const periodo = parseProfitabilityPeriod(request.periodo);
      const { report, user } = await deps.load(periodo, context);
      if (report.categorias.length === 0) return controllerError("BUSINESS_RULE", REPORT_EXPORT_ERROR_MESSAGE);
      const now = deps.now();
      const fecha = formatDateTimeInSantiago(now);
      const name = `RentabilidadCategoria_${periodo.fechaInicio}_${periodo.fechaTermino}_${fecha.slice(0, 10)}.${format}`;
      const selected = await deps.showSaveDialog({
        title: "Guardar reporte de rentabilidad por categoría", defaultPath: join(deps.documentsPath(), name),
        filters: [{ name: format === "pdf" ? "Documento PDF" : "Libro de Excel", extensions: [format] }],
      });
      const result = { formato: format, cantidadFilas: report.categorias.length, fechaGeneracion: now.toISOString() } as const;
      if (selected.canceled || !selected.filePath) return controllerSuccess({ ...result, estado: "cancelled" });
      const input = { report, usuario: user.trabajadorNombre, fecha };
      const contents = await (format === "pdf" ? deps.pdf(input) : deps.xlsx(input));
      const path = ensureExportExtension(selected.filePath, format);
      await deps.save(path, contents);
      return controllerSuccess({ ...result, estado: "saved", ruta: path });
    } catch (error) {
      if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message);
      if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message);
      log.error("[category-profitability-export]", error);
      return controllerError("TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE);
    }
  };
}

export function renderProfitabilityPrintHtml(input: ProfitabilityPrintInput): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Rentabilidad por categoría</title><style>
    @page { size: A4; margin: 12mm; } body { font: 10pt Arial, sans-serif; color: #17202a; }
    h1 { font-size: 18pt; color: #1b4332; } h2 { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; }
    tr { break-inside: avoid; } th,td { padding: 6px; border: 1px solid #cbd5df; text-align: right; overflow-wrap: anywhere; }
    th:first-child,td:first-child { text-align: left; } th { background: #edf7f1; }
    </style></head><body>${renderToStaticMarkup(createElement(ReporteRentabilidadPrintView, input))}</body></html>`;
}

export async function createProfitabilityPdf(input: ProfitabilityPrintInput, createWindow: () => HiddenPrintWindow = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })): Promise<Buffer> {
  const window = createWindow();
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderProfitabilityPrintHtml(input))}`);
    return await window.webContents.printToPDF({ landscape: false, pageSize: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function createProfitabilityXlsx(input: ProfitabilityPrintInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.usuario;
  const sheet = workbook.addWorksheet("Rentabilidad", { views: [{ state: "frozen", ySplit: 7 }] });
  const headings = ["Minimarket y Panadería Huáscar", "Reporte de rentabilidad por categoría", `Período: ${profitabilityPeriodLabel(input.report.periodo)}`, `Generado: ${input.fecha}`, `Usuario: ${input.usuario}`];
  headings.forEach((text, index) => { sheet.mergeCells(index + 1, 1, index + 1, 5); sheet.getCell(index + 1, 1).value = text; });
  sheet.addRow([]);
  sheet.addRow(["Categoría", "Unidades vendidas", "Costo total CLP", "Ingreso neto CLP", "Ganancia sobre costo (%)"]);
  for (const row of input.report.categorias) {
    sheet.addRow([row.categoriaNombre, row.unidadesVendidas, row.costoTotal, row.ingresoNeto,
      row.gananciaPorcentual === null ? "N/A" : row.gananciaPorcentual / 100]);
  }
  sheet.columns.forEach((column, index) => { column.width = index === 0 ? 34 : 26; });
  for (const number of [1, 2, 7]) {
    const row = sheet.getRow(number);
    row.font = { bold: true, color: { argb: "FF1B4332" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF7F1" } };
  }
  sheet.getColumn(3).numFmt = '"$" #,##0';
  sheet.getColumn(4).numFmt = '"$" #,##0';
  sheet.getColumn(5).numFmt = "0.00%";
  sheet.autoFilter = `A7:E${7 + input.report.categorias.length}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const defaults: ProfitabilityExportDependencies = {
  load: loadAuthorizedCategoryProfitability,
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  pdf: createProfitabilityPdf, xlsx: createProfitabilityXlsx,
  save: (path, contents) => writeFile(path, contents), now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
};
