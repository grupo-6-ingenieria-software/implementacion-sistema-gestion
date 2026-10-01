import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { copyFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, schema } from "../../db/client";
import { controllers } from "../../shared/controllers";
import { isReportExportRequest, MONTHLY_SALES_REPORT_TYPE } from "../../shared/monthly-sales";
import { DAILY_SALES_EMPTY_MESSAGE, REPORT_EXPORT_ERROR_MESSAGE, type DailySalesExportRequest, type DailySalesExportResult, type DailySalesReport } from "../../shared/reports";
import { ReporteVentasDiariasPrintView, type DailySalesPrintInput } from "../../renderer/src/components/ReporteVentasDiariasPrintView";
import { controllerError, controllerSuccess, type ControllerHandler, type RegisteredController } from "./base";
import { AccessDeniedError, authorizeUser, registerAuditLog } from "./auth-context";
import { DailySalesReportValidationError, loadDailySalesReport } from "./daily-sales-report-service";
import { formatDateTimeInSantiago, restockReportExportController, type HiddenPrintWindow } from "./restock-report-export";
import { createMonthlySalesExportHandler } from "./monthly-sales-export";
import { PRODUCTS_MOST_SOLD_REPORT_TYPE } from "../../shared/products-most-sold";
import { createProductsMostSoldExportHandler } from "./products-most-sold-export";

type Format = "pdf" | "xlsx";
type SaveDialogResult = { canceled: boolean; filePath?: string };
export type DailySalesExportDependencies = {
  load: (fecha: string) => Promise<DailySalesReport>;
  userName: (usuarioId: string) => Promise<string>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult>;
  createPdf: (input: DailySalesPrintInput) => Promise<Buffer>;
  createXlsx: (input: DailySalesPrintInput) => Promise<Buffer>;
  saveAndAudit: (path: string, contents: Buffer, usuarioId: string, fecha: string, formato: Format) => Promise<void>;
  documentsPath: () => string;
  now: () => Date;
};

export function createDailySalesExportController(dependencies: DailySalesExportDependencies = defaultDependencies): RegisteredController {
  const metadata = controllers.find((item) => item.id === "report-export")!;
  return {
    metadata,
    handle: async (payload, context) => {
      const format = context.channel === "reporte:exportar-pdf" ? "pdf" : context.channel === "reporte:exportar-xlsx" ? "xlsx" : null;
      if (!format) return controllerError("INVALID_CHANNEL", "Canal de exportación inválido.", metadata.id);
      if (context.claims?.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para exportar este reporte.", metadata.id);
      const request = payload as Partial<DailySalesExportRequest> | null;
      if (request?.tipo !== "ventas-diarias" || typeof request.fecha !== "string") {
        return controllerError("VALIDATION_ERROR", "Tipo de reporte o fecha inválidos.", metadata.id);
      }
      try {
        // La identidad, las filas, el encabezado y la ruta nunca se aceptan desde el renderer.
        const report = await dependencies.load(request.fecha);
        if (!report.tieneVentas) return controllerError("BUSINESS_RULE", DAILY_SALES_EMPTY_MESSAGE, metadata.id);
        const usuario = await dependencies.userName(context.claims.usuarioId);
        const generatedAt = dependencies.now();
        const choice = await dependencies.showSaveDialog(buildDailySalesSaveDialog(format, report.fecha, generatedAt, dependencies.documentsPath()));
        if (choice.canceled || !choice.filePath) return controllerSuccess<DailySalesExportResult>({ formato: format, estado: "cancelled" });
        const input: DailySalesPrintInput = { report, generatedAt: formatDateTimeInSantiago(generatedAt), usuario };
        const bytes = format === "pdf" ? await dependencies.createPdf(input) : await dependencies.createXlsx(input);
        const outputPath = ensureExtension(choice.filePath, format);
        await dependencies.saveAndAudit(outputPath, bytes, context.claims.usuarioId, report.fecha, format);
        return controllerSuccess<DailySalesExportResult>({ formato: format, estado: "saved", ruta: outputPath });
      } catch (error) {
        if (error instanceof DailySalesReportValidationError) {
          return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        }
        if (error instanceof AccessDeniedError) {
          return controllerError("FORBIDDEN", error.message, metadata.id);
        }
        const errorName = error instanceof Error ? error.name : "unknown";
        const errorCode = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "unknown";
        log.error(`[report-export] Falló la exportación (${errorName}; código ${errorCode}).`);
        return controllerError("TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE, metadata.id);
      }
    },
  };
}

export function buildDailySalesSaveDialog(format: Format, fecha: string, now: Date, documentsPath: string): SaveDialogOptions {
  const selected = fecha.split("-").reverse().join("-");
  const generated = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }).format(now).replaceAll("/", "-");
  return {
    title: "Guardar reporte diario de ventas",
    defaultPath: join(documentsPath, `ReporteDiarioVentas_${selected}_${generated}.${format}`),
    filters: [{ name: format === "pdf" ? "Documento PDF" : "Libro de Excel", extensions: [format] }],
  };
}

function ensureExtension(path: string, format: Format): string {
  if (path.toLowerCase().endsWith(`.${format}`)) return path;
  const current = extname(path);
  return `${current ? path.slice(0, -current.length) : path}.${format}`;
}

export function renderDailySalesPrintHtml(input: DailySalesPrintInput): string {
  const content = renderToStaticMarkup(createElement(ReporteVentasDiariasPrintView, input));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte diario de ventas</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font: 10pt Arial, sans-serif; color: #17202a; }
    h1 { color: #1b4332; margin-bottom: 2px; } h2 { margin-top: 0; }
    h3 { color: #1b4332; margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    th, td { border: 1px solid #aeb8c2; padding: 5px; text-align: left; }
    th { background: #d8f3dc; } td:last-child { text-align: right; }
  </style></head><body>${content}</body></html>`;
}

export async function createDailySalesPdfBuffer(input: DailySalesPrintInput, createWindow: () => HiddenPrintWindow = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })): Promise<Buffer> {
  let window: HiddenPrintWindow | null = null;
  try {
    window = createWindow();
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderDailySalesPrintHtml(input))}`);
    return await window.webContents.printToPDF({ landscape: true, pageSize: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
}

export async function createDailySalesXlsxBuffer({ report, generatedAt, usuario }: DailySalesPrintInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Minimarket y Panadería Huáscar";
  const sheet = workbook.addWorksheet("Ventas diarias", { views: [{ state: "frozen", ySplit: 7 }] });
  sheet.columns = [{ width: 42 }, { width: 23 }, { width: 27 }, { width: 20 }, { width: 20 }, { width: 20 }];
  sheet.mergeCells("A1:F1"); sheet.getCell("A1").value = "Minimarket y Panadería Huáscar";
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1B4332" } };
  sheet.addRow(["Reporte diario de ventas"]);
  sheet.addRow(["Período", report.fecha.split("-").reverse().join("/")]);
  sheet.addRow(["Fecha y hora de generación", generatedAt]);
  sheet.addRow(["Usuario", usuario]);
  sheet.addRow([]);
  const section = (label: string, headers: string[]) => { sheet.addRow([label]).font = { bold: true, color: { argb: "FF1B4332" } }; sheet.addRow(headers).font = { bold: true }; };
  section("Resumen de ventas vigentes", ["Método de pago", "Cantidad", "Monto"]);
  for (const method of ["efectivo", "debito", "credito", "transferencia"] as const) {
    const summary = report.resumen.porMetodoPago[method]; sheet.addRow([method, summary.cantidad, summary.monto]);
  }
  sheet.addRow(["Total vigente", report.resumen.ventasVigentes, report.resumen.montoVigente]);
  sheet.addRow([]);
  section("Ventas anuladas", ["Cantidad", "Monto original neto"]);
  sheet.addRow([report.resumen.ventasAnuladas, report.resumen.montoAnulado]);
  sheet.addRow([]);
  section("Top 5 productos por unidades", ["Producto", "EAN-13", "Unidades", "Ingreso neto"]);
  report.topProductos.forEach((item) => sheet.addRow([item.nombre, item.ean13, item.unidades, item.montoNeto]));
  sheet.addRow([]);
  sheet.addRow(["Estado de caja", report.caja.estado, report.caja.fechaHoraCierre ?? ""]);
  sheet.addRow([]);
  section("Listado de ventas", ["Número", "Fecha y hora", "Responsable", "Estado", "Método de pago", "Total"]);
  report.ventas.forEach((sale) => sheet.addRow([sale.ventaId, sale.fechaHora, sale.responsable.nombre, sale.estado, sale.metodoPago, sale.total]));
  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}

export async function saveDailySalesWithAudit(path: string, contents: Buffer, usuarioId: string, fecha: string, formato: Format, audit: () => Promise<void> = () => registerAuditLog(db, schema, {
  descripcion: `Exportación de reporte diario de ventas del ${fecha} en ${formato}.`,
  modulo: "reportes", tipoAccion: "exportacion", usuarioId,
})): Promise<void> {
  const suffix = randomUUID();
  const temporary = `${path}.${suffix}.tmp`;
  const backup = `${path}.${suffix}.bak`;
  let existed = false;
  let replaced = false;
  let restoreFailed = false;
  try {
    try { await stat(path); existed = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (existed) await copyFile(path, backup);
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
    replaced = true;
    await audit();
  } catch (error) {
    if (replaced) {
      try {
        if (existed) await copyFile(backup, path);
        else await unlink(path);
      } catch (restoreError) {
        restoreFailed = true;
        log.error("[report-export] No fue posible restaurar el archivo previo; se conservó la copia de respaldo.");
        throw restoreError;
      }
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
    if (!restoreFailed) await unlink(backup).catch(() => undefined);
  }
}

const defaultDependencies: DailySalesExportDependencies = {
  load: (fecha) => loadDailySalesReport(db, fecha),
  userName: async (id) => (await authorizeUser(db, schema, id, ["dueno"])).trabajadorNombre,
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  createPdf: (input) => createDailySalesPdfBuffer(input),
  createXlsx: (input) => createDailySalesXlsxBuffer(input),
  saveAndAudit: saveDailySalesWithAudit,
  documentsPath: () => app.getPath("documents"),
  now: () => new Date(),
};

export const dailySalesExportController = createDailySalesExportController();

export function createReportExportController(
  monthly: ControllerHandler = createMonthlySalesExportHandler(),
  restock: RegisteredController = restockReportExportController,
  productsMostSold: ControllerHandler = createProductsMostSoldExportHandler(),
  daily: RegisteredController = dailySalesExportController,
): RegisteredController {
  const metadata = controllers.find((item) => item.id === "report-export")!;
  return {
    metadata,
    handle: (payload, context) => {
      if (context.channel !== "reporte:exportar-pdf" && context.channel !== "reporte:exportar-xlsx") {
        return Promise.resolve(controllerError("INVALID_CHANNEL", "Canal de exportación inválido.", metadata.id));
      }
      const tipoReporte = (payload as { tipoReporte?: unknown } | null)?.tipoReporte;
      if (tipoReporte === "mermas" || tipoReporte === "lotes-por-vencer" || tipoReporte === "movimientos-inventario") {
        return restock.handle(payload, context);
      }
      if (!isReportExportRequest(context.channel, payload)) return restock.handle(payload, context);
      const tipo = (payload as { tipo?: unknown } | null)?.tipo;
      if (tipo === "ventas-diarias") return daily.handle(payload, context);
      if (tipo === MONTHLY_SALES_REPORT_TYPE) return monthly(payload, context);
      if (tipo === PRODUCTS_MOST_SOLD_REPORT_TYPE) return productsMostSold(payload, context);
      return Promise.resolve(controllerError("VALIDATION_ERROR", "Tipo de reporte no válido.", metadata.id));
    },
  };
}

export const reportExportController = createReportExportController();
