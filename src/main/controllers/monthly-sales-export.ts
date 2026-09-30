import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MONTHLY_SALES_REPORT_TYPE, REPORT_EXPORT_ERROR_MESSAGE, monthlyPeriodKey, monthlyPeriodLabel,
  parseMonthlySalesPeriod, paymentMethodLabels, type ReportExportResult,
} from "../../shared/monthly-sales";
import { ReporteMensualVentasPrintView, type MonthlySalesPrintInput } from "../../renderer/src/components/ReporteMensualVentasPrintView";
import { AccessDeniedError } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerHandler } from "./base";
import { loadAuthorizedMonthlySales } from "./monthly-sales";
import { ensureExportExtension, formatDateTimeInSantiago, type HiddenPrintWindow } from "./restock-report-export";

export type MonthlySalesExportDependencies = {
  load: typeof loadAuthorizedMonthlySales;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;
  pdf: (input: MonthlySalesPrintInput) => Promise<Buffer>;
  xlsx: (input: MonthlySalesPrintInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
};

export function createMonthlySalesExportHandler(deps: MonthlySalesExportDependencies = defaults): ControllerHandler<unknown, ReportExportResult> {
  return async (payload, context) => {
    if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.");
    const format = context.channel === "reporte:exportar-pdf" ? "pdf" : context.channel === "reporte:exportar-xlsx" ? "xlsx" : null;
    if (!format) return controllerError("INVALID_CHANNEL", "Formato de exportación no válido.");
    try {
      const request = payload as { tipo?: unknown; periodo?: unknown } | null;
      if (request?.tipo !== MONTHLY_SALES_REPORT_TYPE) return controllerError("VALIDATION_ERROR", "Tipo de reporte no válido.");
      const period = parseMonthlySalesPeriod(request.periodo);
      const { report, user } = await deps.load(period, context);
      if (report.transacciones === 0) return controllerError("BUSINESS_RULE", REPORT_EXPORT_ERROR_MESSAGE);
      const now = deps.now();
      const fecha = formatDateTimeInSantiago(now);
      const name = `VentasMensuales_${monthlyPeriodKey(period)}_${fecha.slice(0, 10)}.${format}`;
      const selected = await deps.showSaveDialog({
        title: "Guardar reporte mensual de ventas", defaultPath: join(deps.documentsPath(), name),
        filters: [{ name: format === "pdf" ? "Documento PDF" : "Libro de Excel", extensions: [format] }],
      });
      const result = { formato: format, cantidadFilas: report.dias.length, fechaGeneracion: now.toISOString() } as const;
      if (selected.canceled || !selected.filePath) return controllerSuccess({ ...result, estado: "cancelled" });
      const input = { report, usuario: user.trabajadorNombre, fecha };
      const contents = await (format === "pdf" ? deps.pdf(input) : deps.xlsx(input));
      const path = ensureExportExtension(selected.filePath, format);
      await deps.save(path, contents);
      return controllerSuccess({ ...result, estado: "saved", ruta: path });
    } catch (error) {
      if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message);
      if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message);
      log.error("[monthly-sales-export]", error);
      return controllerError("TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE);
    }
  };
}

export function renderMonthlySalesPrintHtml(input: MonthlySalesPrintInput): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte mensual de ventas</title><style>
    @page { size: A4; margin: 12mm; } body { font: 10pt Arial, sans-serif; color: #17202a; }
    h1 { font-size: 18pt; color: #1b4332; } h2 { font-size: 13pt; break-after: avoid; }
    img { display: block; break-inside: avoid; } table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; } tr { break-inside: avoid; } th,td { padding: 5px 8px; border: 1px solid #cbd5df; text-align: right; }
    th:first-child,td:first-child { text-align: left; } th { background: #edf7f1; }
    </style></head><body>${renderToStaticMarkup(createElement(ReporteMensualVentasPrintView, input))}</body></html>`;
}

export async function createMonthlySalesPdf(input: MonthlySalesPrintInput, createWindow: () => HiddenPrintWindow = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })): Promise<Buffer> {
  const window = createWindow();
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderMonthlySalesPrintHtml(input))}`);
    return await window.webContents.printToPDF({ landscape: false, pageSize: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function createMonthlySalesXlsx(input: MonthlySalesPrintInput): Promise<Buffer> {
  const { report } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.usuario;
  const sheet = workbook.addWorksheet("Ventas mensuales", { views: [{ state: "frozen", ySplit: 10 }] });
  const headings = ["Minimarket y Panadería Huáscar", "Reporte mensual de ventas", `Período: ${monthlyPeriodLabel(report.periodo)}`, `Generado: ${input.fecha}`, `Usuario: ${input.usuario}`];
  headings.forEach((text, index) => { sheet.mergeCells(index + 1, 1, index + 1, 3); sheet.getCell(index + 1, 1).value = text; });
  sheet.addRow(["Total del mes", report.transacciones, report.montoTotal]);
  sheet.addRow(["Monto mes anterior", null, report.montoMesAnterior]);
  sheet.addRow(["Variación frente al mes anterior", null, report.variacionPorcentual === null ? "N/A" : report.variacionPorcentual / 100]);
  sheet.getCell("C8").numFmt = "0.00%";
  sheet.addRow([]);
  sheet.addRow(["Fecha", "Transacciones", "Monto CLP"]);
  for (const day of report.dias) sheet.addRow([day.fecha.split("-").reverse().join("/"), day.transacciones, day.monto]);
  sheet.addRow([]);
  const methodsRow = sheet.addRow(["Método de pago", "Transacciones", "Monto CLP"]);
  for (const item of report.metodos) sheet.addRow([paymentMethodLabels[item.metodo], item.transacciones, item.monto]);
  for (const rowNumber of [1, 2, 10, methodsRow.number]) {
    const row = sheet.getRow(rowNumber);
    row.font = { bold: true, color: { argb: "FF1B4332" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF7F1" } };
  }
  sheet.columns.forEach((column, index) => { column.width = index === 0 ? 43 : 23; });
  sheet.getColumn(3).numFmt = '"$" #,##0';
  sheet.getCell("C8").numFmt = "0.00%";
  sheet.autoFilter = `A10:C${10 + report.dias.length}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const defaults: MonthlySalesExportDependencies = {
  load: loadAuthorizedMonthlySales,
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  pdf: createMonthlySalesPdf, xlsx: createMonthlySalesXlsx,
  save: (path, contents) => writeFile(path, contents), now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
};
