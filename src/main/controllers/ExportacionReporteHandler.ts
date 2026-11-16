import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { copyFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, schema, type DB } from "../../db/client";
import * as inventorySchema from "../../db/schema";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import { normalizeRestockListRequest, RESTOCK_EMPTY_MESSAGE, RESTOCK_EXPORT_ERROR_MESSAGE, type RestockExportFormat, type RestockExportResult } from "../../shared/restock";
import { INVENTORY_AUDIT_WARNING, INVENTORY_BUSINESS_NAME, INVENTORY_EMPTY_MESSAGE, INVENTORY_EXPORT_CHANNEL, INVENTORY_EXPORT_ERROR_MESSAGE, inventoryExportFormat, type InventoryExportFormat, type InventoryExportItem, type InventoryExportResult, type InventoryReportInput } from "../../shared/inventory-export";
import { isReportExportRequest, REPORT_RECONCILE_CHANNEL } from "../../shared/reports";
import { DAILY_SALES_EMPTY_MESSAGE, REPORT_EXPORT_ERROR_MESSAGE, type DailySalesExportRequest, type DailySalesExportResult, type DailySalesReport } from "../../shared/reports";
import { ReporteVentasDiariasPrintView, type DailySalesPrintInput } from "../../renderer/src/components/ReporteVentasDiariasPrintView";
import { controllerError, controllerSuccess, type ControllerHandler, type RegisteredController } from "./BaseControladorAuxiliar";
import { AccessDeniedError, authorizeUser, registerAuditLog, type AuthenticatedUser } from "./ContextoAutenticacionAuxiliar";
import { InventoryExportDataError, queryInventoryExportWithExecutor } from "./ConsultaExportacionInventarioAuxiliar";
import { buildInventorySaveDialogOptions, confirmInventoryDestination, createInventoryPdfBuffer, createInventoryXlsxBuffer, saveInventoryFile, technicalErrorDetails } from "./ArchivoExportacionInventarioAuxiliar";
import { DailySalesReportValidationError, loadDailySalesReport } from "./ReporteVentasDiaAuxiliar";
import {
  buildSaveDialogOptions,
  effectiveSessionRole,
  ensureExportExtension,
  formatDateTimeInSantiago,
  formatForChannel,
  handleExpiringLotsReportExport,
  handleMovementReportExport,
  handleWasteReportExport,
  restockExportDependencies,
  type HiddenPrintWindow,
  type RestockExportDependencies,
  type RestockReportInput,
} from "./GeneracionArchivosReporteAuxiliar";
import { createReportExportHandler } from "./ServicioExportacionReporteAuxiliar";
import { CATEGORY_PROFITABILITY_REPORT_TYPE } from "../../shared/category-profitability";
import { createCategoryProfitabilityExportHandler } from "./ExportacionReporteRentabilidadAuxiliar";
import { ATTENDANCE_REPORT_TYPE } from "../../shared/attendance-report";
import { createAttendanceReportExportHandler } from "./ExportacionReporteAsistenciaAuxiliar";
import { PRODUCTS_MOST_SOLD_REPORT_TYPE } from "../../shared/products-most-sold";
import { createProductsMostSoldExportHandler } from "./ExportacionReporteProductosMasVendidosAuxiliar";
import { formatDisplayDateTime } from "../../shared/date-time";

type Format = "pdf" | "xlsx";
type SaveDialogResult = { canceled: boolean; filePath?: string };
const REPORT_EXPORT_ID = "report-export";
const RESTOCK_EXPORT_CHANNELS: ReadonlySet<string> = new Set([
  "inventario:reabastecimiento:exportar-pdf",
  "inventario:reabastecimiento:exportar-xlsx",
]);

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

export function createDailySalesExportController(dependencies: DailySalesExportDependencies = defaultDependencies): ControllerHandler {
  return async (payload, context) => {
    const format = context.channel === "reporte:exportar-pdf" ? "pdf" : context.channel === "reporte:exportar-xlsx" ? "xlsx" : null;
    if (!format) return controllerError("INVALID_CHANNEL", "Canal de exportación inválido.", REPORT_EXPORT_ID);
    if (context.claims?.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para exportar este reporte.", REPORT_EXPORT_ID);
    const request = payload as Partial<DailySalesExportRequest> | null;
    if (request?.tipo !== "ventas-diarias" || typeof request.fecha !== "string") {
      return controllerError("VALIDATION_ERROR", "Tipo de reporte o fecha inválidos.", REPORT_EXPORT_ID);
    }
    try {
      // La identidad, las filas, el encabezado y la ruta nunca se aceptan desde el renderer.
      const report = await dependencies.load(request.fecha);
      if (!report.tieneVentas) return controllerError("BUSINESS_RULE", DAILY_SALES_EMPTY_MESSAGE, REPORT_EXPORT_ID);
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
        return controllerError("VALIDATION_ERROR", error.message, REPORT_EXPORT_ID);
      }
      if (error instanceof AccessDeniedError) {
        return controllerError("FORBIDDEN", error.message, REPORT_EXPORT_ID);
      }
      const errorName = error instanceof Error ? error.name : "unknown";
      const errorCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown";
      log.error(`[report-export] Falló la exportación (${errorName}; código ${errorCode}).`);
      return controllerError("TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE, REPORT_EXPORT_ID);
    }
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
  sheet.addRow(["Fecha y hora de generación", formatDisplayDateTime(generatedAt)]);
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
  sheet.addRow(["Estado de caja", report.caja.estado, report.caja.fechaHoraCierre ? formatDisplayDateTime(report.caja.fechaHoraCierre) : ""]);
  sheet.addRow([]);
  section("Listado de ventas", ["Número", "Fecha y hora", "Responsable", "Estado", "Método de pago", "Total"]);
  report.ventas.forEach((sale) => sheet.addRow([sale.ventaId, formatDisplayDateTime(sale.fechaHora), sale.responsable.nombre, sale.estado, sale.metodoPago, sale.total]));
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

export function createRestockReportExportController(
  dependencies: RestockExportDependencies = restockExportDependencies,
): ControllerHandler {
  const handle: ControllerHandler<unknown, RestockExportResult> = async (
    payload,
    context,
  ) => {
    const format = formatForChannel(context.channel);

    if (!format) {
      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "report-export",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    try {
      const record =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>)
          : {};
      if (record.tipoReporte === "mermas") {
        return await handleWasteReportExport(
          record,
          context,
          format,
          dependencies,
        );
      }
      if (record.tipoReporte === "lotes-por-vencer") {
        return await handleExpiringLotsReportExport(
          record,
          context,
          format,
          dependencies,
        );
      }
      if (record.tipoReporte === "movimientos-inventario") {
        return await handleMovementReportExport(
          record,
          context,
          format,
          dependencies,
        );
      }

      // Se extrae exclusivamente la identidad. Las filas, encabezados y rutas
      // que pudiera agregar el renderer quedan deliberadamente ignorados.
      const request = normalizeRestockListRequest(payload);
      const { items, user } = await dependencies.load(
        request,
        effectiveSessionRole(context),
      );

      if (items.length === 0) {
        return {
          ok: false,
          error: {
            code: "BUSINESS_RULE",
            controllerId: "report-export",
            message: RESTOCK_EMPTY_MESSAGE,
          },
        };
      }

      const generatedAt = dependencies.now();
      const fechaGeneracion = generatedAt.toISOString();
      const dialogResult = await dependencies.showSaveDialog(
        buildSaveDialogOptions(
          format,
          generatedAt,
          dependencies.documentsPath(),
        ),
      );

      if (dialogResult.canceled || !dialogResult.filePath) {
        return {
          ok: true,
          data: {
            formato: format,
            estado: "cancelled",
            cantidadFilas: items.length,
            fechaGeneracion,
          },
        };
      }

      const input: RestockReportInput = {
        fecha: formatDateTimeInSantiago(generatedAt),
        items,
        usuario: user.trabajadorNombre,
      };
      const contents =
        format === "pdf"
          ? await dependencies.createPdf(input)
          : await dependencies.createXlsx(input);
      const outputPath = ensureExportExtension(dialogResult.filePath, format);
      await dependencies.save(outputPath, contents);

      return {
        ok: true,
        data: {
          formato: format,
          estado: "saved",
          ruta: outputPath,
          cantidadFilas: items.length,
          fechaGeneracion,
        },
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: "report-export",
            message: error.message,
          },
        };
      }

      console.error("[restock-report-export] Error:", error);
      return {
        ok: false,
        error: {
          code: "TECHNICAL_ERROR",
          controllerId: "report-export",
          message: RESTOCK_EXPORT_ERROR_MESSAGE,
        },
      };
    }
  };

  return handle;
}

export type InventoryExportDependencies = {
  authorize: (usuarioId: string, role: Role) => Promise<AuthenticatedUser>;
  query: () => Promise<InventoryExportItem[]>;
  showSaveDialog: (
    options: SaveDialogOptions,
  ) => Promise<{ canceled: boolean; filePath?: string }>;
  confirmDestination: (
    outputPath: string,
    selectedPath: string,
  ) => Promise<boolean>;
  createPdf: (input: InventoryReportInput) => Promise<Buffer>;
  createXlsx: (input: InventoryReportInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  audit: (
    usuarioId: string,
    format: InventoryExportFormat,
    count: number,
  ) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
  logError: (stage: string, error: unknown) => void;
};

export async function auditInventoryExportWithExecutor(
  executor: DB,
  usuarioId: string,
  format: InventoryExportFormat,
  count: number,
): Promise<void> {
  await executor.transaction(async (tx) => {
    await registerAuditLog(tx, inventorySchema, {
      usuarioId,
      tipoAccion: "exportacion",
      modulo: "inventario",
      descripcion: `Exportación de listado de inventario en ${format.toUpperCase()}: ${count} productos.`,
    });
  });
}

export function createInventoryExportController(
  dependencies: InventoryExportDependencies = defaultInventoryDependencies,
): ControllerHandler<unknown, InventoryExportResult> {
  const fail = (code: Parameters<typeof controllerError>[0], message: string) =>
    controllerError(code, message, REPORT_EXPORT_ID);
  const reportError = (stage: string, error: unknown) => {
    // Un fallo del logger tampoco puede convertir un archivo guardado en error.
    try {
      dependencies.logError(stage, error);
    } catch {
      /* best effort */
    }
  };
  const handle: ControllerHandler<unknown, InventoryExportResult> = async (
    payload,
    context,
  ) => {
    if (context.channel !== INVENTORY_EXPORT_CHANNEL)
      return fail("INVALID_CHANNEL", "Canal IPC no registrado.");
    const claims = context.claims;
    if (
      !claims?.usuarioId ||
      (claims.rol !== "dueno" && claims.rol !== "trabajador")
    ) {
      return fail(
        "FORBIDDEN",
        "No hay una sesión válida para realizar esta acción.",
      );
    }
    const format = inventoryExportFormat(payload);
    if (!format) return fail("VALIDATION_ERROR", "Seleccione Excel o PDF.");
    let stage = "autorizacion";
    try {
      const user = await dependencies.authorize(claims.usuarioId, claims.rol);
      stage = "consulta";
      const items = await dependencies.query();
      if (!items.length) return fail("BUSINESS_RULE", INVENTORY_EMPTY_MESSAGE);
      const generatedAt = dependencies.now();
      const base = {
        formato: format,
        cantidadFilas: items.length,
        fechaGeneracion: generatedAt.toISOString(),
      };
      const cancelled = () =>
        controllerSuccess<InventoryExportResult>({
          ...base,
          estado: "cancelled",
        });
      stage = "destino";
      const destination = await dependencies.showSaveDialog(
        buildInventorySaveDialogOptions(
          format,
          generatedAt,
          dependencies.documentsPath(),
        ),
      );
      if (destination.canceled || !destination.filePath) return cancelled();
      const path = ensureExportExtension(destination.filePath, format);
      if (!(await dependencies.confirmDestination(path, destination.filePath)))
        return cancelled();
      const input: InventoryReportInput = {
        negocio: INVENTORY_BUSINESS_NAME,
        fecha: formatDateTimeInSantiago(generatedAt),
        fechaGeneracion: base.fechaGeneracion,
        usuario: user.trabajadorNombre,
        items,
      };
      stage = "generacion";
      const contents =
        format === "pdf"
          ? await dependencies.createPdf(input)
          : await dependencies.createXlsx(input);
      if (!contents.length) throw new Error("EmptyExportBuffer");
      stage = "guardado";
      await dependencies.save(path, contents);
      try {
        await dependencies.audit(user.usuarioId, format, items.length);
        return controllerSuccess<InventoryExportResult>({
          ...base,
          estado: "saved",
          ruta: path,
          auditoria: "registrada",
        });
      } catch (error) {
        reportError("auditoria", error);
        return controllerSuccess<InventoryExportResult>({
          ...base,
          estado: "saved",
          ruta: path,
          auditoria: "fallida",
          advertencia: INVENTORY_AUDIT_WARNING,
        });
      }
    } catch (error) {
      if (error instanceof AccessDeniedError)
        return fail("FORBIDDEN", error.message);
      reportError(stage, error);
      return fail(
        error instanceof InventoryExportDataError
          ? "BUSINESS_RULE"
          : stage === "consulta" || stage === "autorizacion"
            ? "DATABASE_ERROR"
            : "TECHNICAL_ERROR",
        INVENTORY_EXPORT_ERROR_MESSAGE,
      );
    }
  };
  return handle;
}

const defaultInventoryDependencies: InventoryExportDependencies = {
  authorize: async (usuarioId, role) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, ["dueno", "trabajador"], role);
  },
  query: async () =>
    queryInventoryExportWithExecutor((await import("../../db/client")).db),
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  confirmDestination: confirmInventoryDestination,
  createPdf: createInventoryPdfBuffer,
  createXlsx: createInventoryXlsxBuffer,
  save: saveInventoryFile,
  audit: async (id, format, count) =>
    auditInventoryExportWithExecutor(
      (await import("../../db/client")).db,
      id,
      format,
      count,
    ),
  now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
  logError: (stage, error) =>
    log.error(
      `[CU20] ${stage}`,
      technicalErrorDetails(error),
      error instanceof InventoryExportDataError ? error.productos : undefined,
    ),
};

export function createExportacionReporteHandler(
  reports: ControllerHandler = createReportExportHandler(),
  restock: ControllerHandler = createRestockReportExportController(),
  productsMostSold: ControllerHandler = createProductsMostSoldExportHandler(),
  daily: ControllerHandler = createDailySalesExportController(),
  profitability: ControllerHandler = createCategoryProfitabilityExportHandler(),
  attendance: ControllerHandler = createAttendanceReportExportHandler(),
  inventory: ControllerHandler = createInventoryExportController(),
): RegisteredController {
  const metadata = controllers.find((item) => item.id === REPORT_EXPORT_ID)!;
  return {
    metadata,
    handle: (payload, context) => {
      if (context.channel === INVENTORY_EXPORT_CHANNEL) return inventory(payload, context);
      if (context.channel === REPORT_RECONCILE_CHANNEL) return reports(payload, context);
      if (RESTOCK_EXPORT_CHANNELS.has(context.channel)) return restock(payload, context);
      if (context.channel !== "reporte:exportar-pdf" && context.channel !== "reporte:exportar-xlsx") {
        return Promise.resolve(controllerError("INVALID_CHANNEL", "Canal de exportación inválido.", REPORT_EXPORT_ID));
      }
      const tipoReporte = (payload as { tipoReporte?: unknown } | null)?.tipoReporte;
      if (tipoReporte === "mermas" || tipoReporte === "lotes-por-vencer" || tipoReporte === "movimientos-inventario") {
        return restock(payload, context);
      }
      if (!isReportExportRequest(context.channel, payload)) return restock(payload, context);
      const tipo = (payload as { tipo?: unknown } | null)?.tipo;
      if (tipo === "ventas-diarias") return daily(payload, context);
      if (tipo === PRODUCTS_MOST_SOLD_REPORT_TYPE) return productsMostSold(payload, context);
      if (tipo === CATEGORY_PROFITABILITY_REPORT_TYPE) return profitability(payload, context);
      if (tipo === ATTENDANCE_REPORT_TYPE) return attendance(payload, context);
      return reports(payload, context);
    },
  };
}

export const exportacionReporteHandler = createExportacionReporteHandler();
