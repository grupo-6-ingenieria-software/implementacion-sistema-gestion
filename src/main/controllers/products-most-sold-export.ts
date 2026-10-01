import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PRODUCTS_MOST_SOLD_REPORT_TYPE,
  formatProductsMostSoldDisplayDate,
  parseProductsMostSoldPeriod,
} from "../../shared/products-most-sold";
import { REPORT_EXPORT_ERROR_MESSAGE, type ReportExportResult } from "../../shared/monthly-sales";
import { ReporteProductosVendidosPrintView, type ProductsMostSoldPrintInput } from "../../renderer/src/components/ReporteProductosVendidosPrintView";
import { AccessDeniedError } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerHandler } from "./base";
import { loadAuthorizedProductsMostSold } from "./products-most-sold";
import { ensureExportExtension, formatDateTimeInSantiago, type HiddenPrintWindow } from "./restock-report-export";

export type ProductsMostSoldExportDependencies = {
  load: typeof loadAuthorizedProductsMostSold;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;
  pdf: (input: ProductsMostSoldPrintInput) => Promise<Buffer>;
  xlsx: (input: ProductsMostSoldPrintInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
};

export function createProductsMostSoldExportHandler(
  deps: ProductsMostSoldExportDependencies = defaults,
): ControllerHandler<unknown, ReportExportResult> {
  return async (payload, context) => {
    if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.");
    const format = context.channel === "reporte:exportar-pdf" ? "pdf" : context.channel === "reporte:exportar-xlsx" ? "xlsx" : null;
    if (!format) return controllerError("INVALID_CHANNEL", "Formato de exportación no válido.");
    try {
      const request = payload as { tipo?: unknown; periodo?: unknown } | null;
      if (request?.tipo !== PRODUCTS_MOST_SOLD_REPORT_TYPE) return controllerError("VALIDATION_ERROR", "Tipo de reporte no válido.");
      let period;
      try {
        period = parseProductsMostSoldPeriod(request.periodo);
      } catch (error) {
        return controllerError("VALIDATION_ERROR", (error as Error).message);
      }
      const { report, user } = await deps.load(period, context);
      if (report.status === "empty" || report.filas.length === 0) return controllerError("BUSINESS_RULE", REPORT_EXPORT_ERROR_MESSAGE);
      const now = deps.now();
      const fecha = formatDateTimeInSantiago(now);
      const name = `ProductosMasVendidos_${period.fechaInicio}_a_${period.fechaTermino}_${fecha.slice(0, 10)}.${format}`;
      const selected = await deps.showSaveDialog({
        title: "Guardar reporte de productos más vendidos",
        defaultPath: join(deps.documentsPath(), name),
        filters: [{ name: format === "pdf" ? "Documento PDF" : "Libro de Excel", extensions: [format] }],
      });
      const result = { formato: format, cantidadFilas: report.filas.length, fechaGeneracion: now.toISOString() } as const;
      if (selected.canceled || !selected.filePath) return controllerSuccess({ ...result, estado: "cancelled" });
      const input = { report, usuario: user.trabajadorNombre, fecha };
      const contents = await (format === "pdf" ? deps.pdf(input) : deps.xlsx(input));
      const path = ensureExportExtension(selected.filePath, format);
      await deps.save(path, contents);
      return controllerSuccess({ ...result, estado: "saved", ruta: path });
    } catch (error) {
      if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message);
      log.error("[products-most-sold-export]", error);
      return controllerError("TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE);
    }
  };
}

export function renderProductsMostSoldPrintHtml(input: ProductsMostSoldPrintInput): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Productos más vendidos</title><style>
    @page { size: A4 landscape; margin: 12mm; } body { font: 9pt Arial, sans-serif; color: #17202a; }
    h1 { font-size: 17pt; color: #1b4332; } h2 { font-size: 12pt; break-after: avoid; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; }
    tr { break-inside: avoid; } th,td { padding: 5px 7px; border: 1px solid #cbd5df; }
    th:nth-child(n+4),td:nth-child(n+4) { text-align: right; } th { background: #edf7f1; }
    </style></head><body>${renderToStaticMarkup(createElement(ReporteProductosVendidosPrintView, input))}</body></html>`;
}

export async function createProductsMostSoldPdf(
  input: ProductsMostSoldPrintInput,
  createWindow: () => HiddenPrintWindow = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }),
): Promise<Buffer> {
  const window = createWindow();
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderProductsMostSoldPrintHtml(input))}`);
    return await window.webContents.printToPDF({ landscape: true, pageSize: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function createProductsMostSoldXlsx(input: ProductsMostSoldPrintInput): Promise<Buffer> {
  const { report } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.usuario;
  const sheet = workbook.addWorksheet("Productos más vendidos", { views: [{ state: "frozen", ySplit: 7 }] });
  const headings = [
    "Minimarket y Panadería Huáscar",
    "Reporte de productos más vendidos",
    `Período: ${formatProductsMostSoldDisplayDate(report.periodo.fechaInicio)} al ${formatProductsMostSoldDisplayDate(report.periodo.fechaTermino)}`,
    `Generado: ${input.fecha}`,
    `Usuario: ${input.usuario}`,
  ];
  headings.forEach((heading, index) => { sheet.mergeCells(index + 1, 1, index + 1, 6); sheet.getCell(index + 1, 1).value = heading; });
  sheet.addRow(["Total de unidades del período", report.totalUnidadesPeriodo]);
  sheet.addRow(["EAN", "Producto", "Categoría", "Unidades", "Ingreso neto CLP", "% de unidades"]);
  for (const row of report.filas) {
    sheet.addRow([row.ean13, row.nombre, row.categoria, row.unidadesVendidas, row.ingresoNeto, row.porcentajeUnidades / 100]);
  }
  for (const rowNumber of [1, 2, 7]) {
    const row = sheet.getRow(rowNumber);
    row.font = { bold: true, color: { argb: "FF1B4332" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF7F1" } };
  }
  [20, 36, 27, 15, 22, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getColumn(5).numFmt = '"$" #,##0';
  sheet.getColumn(6).numFmt = "0.00%";
  sheet.autoFilter = `A7:F${7 + report.filas.length}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const defaults: ProductsMostSoldExportDependencies = {
  load: loadAuthorizedProductsMostSold,
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  pdf: createProductsMostSoldPdf,
  xlsx: createProductsMostSoldXlsx,
  save: (path, contents) => writeFile(path, contents),
  now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
};
