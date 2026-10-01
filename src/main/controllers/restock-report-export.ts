import { app, BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  normalizeRestockListRequest,
  RESTOCK_EMPTY_MESSAGE,
  RESTOCK_EXPORT_ERROR_MESSAGE,
  type RestockExportFormat,
  type RestockExportResult,
  type RestockItem,
  type RestockListRequest,
} from "../../shared/restock";
import { ListaReabastecimientoPrintView } from "../../renderer/src/components/ListaReabastecimientoPrintView";
import { ReporteMermasPrintView } from "../../renderer/src/components/ReporteMermasPrintView";
import { queryWasteReportFromDb } from "./waste-report";
import {
  normalizeWasteReportRequest,
  validateWasteReportRequest,
  WASTE_REPORT_EMPTY_MESSAGE,
  type WasteReportData,
  type WasteReportRequest,
} from "../../shared/report-waste";
import { ReporteLotesVencerPrintView } from "../../renderer/src/components/ReporteLotesVencerPrintView";
import { queryExpiringLotsReportFromDb } from "./expiring-lots-report";
import {
  DEFAULT_EXPIRING_LOTS_HORIZON,
  EXPIRING_LOTS_EMPTY_MESSAGE,
  EXPIRING_LOTS_HORIZON_ERROR,
  normalizeExpiringLotsRequest,
  validateExpiringLotsRequest,
  type ExpiringLotsReportData,
  type ExpiringLotsReportRequest,
} from "../../shared/report-expiring-lots";
import { ReporteMovimientosPrintView } from "../../renderer/src/components/ReporteMovimientosPrintView";
import { queryMovementReportFromDb } from "./movement-report";
import {
  MOVEMENT_REPORT_EMPTY_MESSAGE,
  MOVEMENT_TYPE_LABELS,
  normalizeMovementReportRequest,
  validateMovementReportRequest,
  type MovementReportData,
  type MovementReportRequest,
  type MovementReportType,
} from "../../shared/report-movements";
import { registerAuditLog } from "./auth-context";
import { db, schema as appSchema } from "../../db/client";
import type { ControllerResponse } from "../../shared/controllers";
import type {
  ControllerContext,
  ControllerHandler,
  RegisteredController,
} from "./base";
import { AccessDeniedError } from "./auth-context";
import {
  loadAuthorizedRestockList,
  type AuthorizedRestockList,
} from "./restock-list";

type SaveDialogResult = {
  canceled: boolean;
  filePath?: string;
};

export type WasteReportPrintInput = {
  fechaInicio: string;
  fechaTermino: string;
  fechaGeneracion: string;
  items: WasteReportData["items"];
  resumen: WasteReportData["resumen"];
  usuario: string;
};

export type RestockExportDependencies = {
  load: (
    request: RestockListRequest,
    sessionRole?: Role,
  ) => Promise<AuthorizedRestockList>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult>;
  createPdf: (input: RestockReportInput) => Promise<Buffer>;
  createXlsx: (input: RestockReportInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
  loadWasteReport?: (request: WasteReportRequest) => Promise<WasteReportData>;
  createWastePdf?: (input: WasteReportPrintInput) => Promise<Buffer>;
  createWasteXlsx?: (input: WasteReportPrintInput) => Promise<Buffer>;
  loadExpiringLotsReport?: (
    request: ExpiringLotsReportRequest,
  ) => Promise<ExpiringLotsReportData>;
  createExpiringLotsPdf?: (
    input: ExpiringLotsReportPrintInput,
  ) => Promise<Buffer>;
  createExpiringLotsXlsx?: (
    input: ExpiringLotsReportPrintInput,
  ) => Promise<Buffer>;
  loadMovementReport?: (
    request: MovementReportRequest,
  ) => Promise<MovementReportData>;
  createMovementPdf?: (
    input: MovementReportPrintInput,
  ) => Promise<Buffer>;
  createMovementXlsx?: (
    input: MovementReportPrintInput,
  ) => Promise<Buffer>;
  audit?: (event: {
    usuarioId: string;
    modulo: string;
    tipoAccion: string;
    descripcion: string;
  }) => Promise<void>;
};

export type MovementReportPrintInput = {
  fechaInicio: string;
  fechaTermino: string;
  tipoNombre?: string;
  categoriaNombre?: string;
  usuarioFiltroNombre?: string;
  fechaGeneracion: string;
  items: MovementReportData["items"];
  resumen: MovementReportData["resumen"];
  usuario: string;
};

export type ExpiringLotsReportPrintInput = {
  horizonte: number;
  categoriaNombre?: string;
  fechaGeneracion: string;
  items: ExpiringLotsReportData["items"];
  resumen: ExpiringLotsReportData["resumen"];
  usuario: string;
};

export type RestockReportInput = {
  fecha: string;
  items: readonly RestockItem[];
  usuario: string;
};

export type HiddenPrintWindow = {
  destroy: () => void;
  isDestroyed: () => boolean;
  loadURL: (url: string) => Promise<void>;
  webContents: {
    printToPDF: (options: {
      landscape: boolean;
      pageSize: "A4";
      preferCSSPageSize: boolean;
      printBackground: boolean;
    }) => Promise<Buffer>;
  };
};

export type PdfGenerationDependencies = {
  createWindow: () => HiddenPrintWindow;
};

export function createRestockReportExportController(
  dependencies: RestockExportDependencies = restockExportDependencies,
): RegisteredController {
  const metadata = controllers.find(
    (controller) => controller.id === "restock-report-export",
  )!;

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
          controllerId: "restock-report-export",
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
            controllerId: "restock-report-export",
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
            controllerId: "restock-report-export",
            message: error.message,
          },
        };
      }

      console.error("[restock-report-export] Error:", error);
      return {
        ok: false,
        error: {
          code: "TECHNICAL_ERROR",
          controllerId: "restock-report-export",
          message: RESTOCK_EXPORT_ERROR_MESSAGE,
        },
      };
    }
  };

  return { metadata, handle };
}

export function buildSaveDialogOptions(
  format: RestockExportFormat,
  generatedAt: Date,
  documentsPath: string,
): SaveDialogOptions {
  const extension = format;
  const label = format === "pdf" ? "Documento PDF" : "Libro de Excel";

  return {
    title: "Guardar lista de reabastecimiento",
    defaultPath: join(
      documentsPath,
      `lista-reabastecimiento-${formatFilenameDateInSantiago(generatedAt)}.${extension}`,
    ),
    filters: [{ name: label, extensions: [extension] }],
  };
}

export function ensureExportExtension(
  filePath: string,
  format: RestockExportFormat,
): string {
  const expectedExtension = `.${format}`;
  if (filePath.toLocaleLowerCase("en").endsWith(expectedExtension)) {
    return filePath;
  }

  const currentExtension = extname(filePath);
  return currentExtension
    ? `${filePath.slice(0, -currentExtension.length)}${expectedExtension}`
    : `${filePath}${expectedExtension}`;
}

export function formatDateTimeInSantiago(date: Date): string {
  const parts = getSantiagoDateParts(date);
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`;
}

export function formatFilenameDateInSantiago(date: Date): string {
  const parts = getSantiagoDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}`;
}

export function renderRestockPrintHtml(input: RestockReportInput): string {
  const markup = renderToStaticMarkup(
    createElement(ListaReabastecimientoPrintView, input),
  );

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Lista de reabastecimiento</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #17202a; font-family: Arial, sans-serif; font-size: 10pt; }
      h1 { margin: 0; color: #1b4332; font-size: 20pt; }
      h2 { margin: 4px 0 12px; font-size: 14pt; }
      .report-metadata { display: flex; gap: 32px; margin: 0 0 16px; }
      .report-metadata div { display: flex; gap: 6px; }
      dt { font-weight: 700; }
      dd { margin: 0; }
      table { width: 100%; border-collapse: collapse; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th, td { border: 1px solid #aeb8c2; padding: 6px 8px; }
      th { background: #d8f3dc; color: #17202a; text-align: left; }
      tbody tr:nth-child(even) { background: #f6f7f9; }
      .numeric { text-align: right; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

export async function createRestockPdfBuffer(
  input: RestockReportInput,
  dependencies: PdfGenerationDependencies = defaultPdfGenerationDependencies,
): Promise<Buffer> {
  let window: HiddenPrintWindow | null = null;

  try {
    window = dependencies.createWindow();
    const html = renderRestockPrintHtml(input);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await window.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

export async function createRestockXlsxBuffer(
  input: RestockReportInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Minimarket y Panadería Huáscar";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Reabastecimiento", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = "Minimarket y Panadería Huáscar";
  sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 16 };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B4332" },
  };
  sheet.mergeCells("A2:F2");
  sheet.getCell("A2").value = `Fecha de generación: ${input.fecha}`;
  sheet.mergeCells("A3:F3");
  sheet.getCell("A3").value = `Usuario: ${input.usuario}`;

  const headers = [
    "Producto",
    "EAN-13",
    "Categoría",
    "Stock actual",
    "Stock mínimo",
    "Cantidad sugerida",
  ];
  const headerRow = sheet.getRow(5);
  headerRow.values = headers;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2D6A4F" },
  };

  for (const item of input.items) {
    sheet.addRow([
      item.nombre,
      item.ean13,
      item.categoria,
      item.stockActual,
      item.stockMinimo,
      item.cantidadSugerida,
    ]);
  }

  sheet.autoFilter = "A5:F5";
  const widths = [32, 17, 24, 15, 15, 20];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (let rowNumber = 6; rowNumber <= sheet.rowCount; rowNumber += 1) {
    for (let columnNumber = 4; columnNumber <= 6; columnNumber += 1) {
      sheet.getCell(rowNumber, columnNumber).numFmt = "0";
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function formatForChannel(channel: string): RestockExportFormat | null {
  if (channel === "reporte:exportar-pdf") return "pdf";
  if (channel === "reporte:exportar-xlsx") return "xlsx";
  return null;
}

function effectiveSessionRole(context: ControllerContext): Role | undefined {
  return context.claims?.rol;
}

function getSantiagoDateParts(date: Date): Record<
  "day" | "month" | "year" | "hour" | "minute",
  string
> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const result = {} as Record<
    "day" | "month" | "year" | "hour" | "minute",
    string
  >;

  for (const part of formatter.formatToParts(date)) {
    if (
      part.type === "day" ||
      part.type === "month" ||
      part.type === "year" ||
      part.type === "hour" ||
      part.type === "minute"
    ) {
      result[part.type] = part.value;
    }
  }

  return result;
}

const defaultPdfGenerationDependencies: PdfGenerationDependencies = {
  createWindow: () =>
    new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
};

export function renderWasteReportPrintHtml(input: WasteReportPrintInput): string {
  const markup = renderToStaticMarkup(
    createElement(ReporteMermasPrintView, input),
  );

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reporte de mermas</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #17202a; font-family: Arial, sans-serif; font-size: 9pt; }
      h1 { margin: 0; color: #1b4332; font-size: 18pt; }
      h2 { margin: 4px 0 10px; font-size: 13pt; }
      .report-metadata { display: flex; gap: 28px; margin: 0 0 14px; }
      .report-metadata div { display: flex; gap: 6px; }
      dt { font-weight: 700; }
      dd { margin: 0; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th, td { border: 1px solid #aeb8c2; padding: 5px 6px; }
      th { background: #d8f3dc; color: #17202a; text-align: left; }
      tbody tr:nth-child(even) { background: #f6f7f9; }
      .numeric { text-align: right; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

export async function createWastePdfBuffer(
  input: WasteReportPrintInput,
  dependencies: PdfGenerationDependencies = defaultPdfGenerationDependencies,
): Promise<Buffer> {
  let window: HiddenPrintWindow | null = null;

  try {
    window = dependencies.createWindow();
    const html = renderWasteReportPrintHtml(input);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await window.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

export async function createWasteXlsxBuffer(
  input: WasteReportPrintInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Minimarket y Panadería Huáscar";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Mermas", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").value = "Minimarket y Panadería Huáscar - Reporte de mermas";
  sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 16 };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B4332" },
  };
  sheet.mergeCells("A2:I2");
  sheet.getCell("A2").value = `Período: ${input.fechaInicio} al ${input.fechaTermino} | Generado: ${input.fechaGeneracion} | Usuario: ${input.usuario}`;
  sheet.mergeCells("A3:I3");
  sheet.getCell("A3").value = `Resumen: ${input.resumen.totalUnidades} unidades mermadas | Costo total: $${input.resumen.costoTotal.toLocaleString("es-CL")} (Vencimiento: ${input.resumen.unidadesPorMotivo.vencimiento}, Daño: ${input.resumen.unidadesPorMotivo.dano}, Robo: ${input.resumen.unidadesPorMotivo.robo}, Error registro: ${input.resumen.unidadesPorMotivo.error_registro})`;

  const headers = [
    "Fecha y hora",
    "Producto",
    "EAN-13",
    "Categoría",
    "Cantidad",
    "Motivo",
    "Costo unitario",
    "Costo total",
    "Responsable",
  ];
  const headerRow = sheet.getRow(5);
  headerRow.values = headers;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2D6A4F" },
  };

  const MOTIVO_LABELS: Record<string, string> = {
    vencimiento: "Vencimiento",
    dano: "Daño",
    robo: "Robo",
    error_registro: "Error de registro",
  };

  for (const item of input.items) {
    sheet.addRow([
      item.fechaHora,
      item.productoNombre,
      item.productoEan13,
      item.categoriaNombre,
      item.cantidad,
      MOTIVO_LABELS[item.motivo] ?? item.motivo,
      item.costoUnitario,
      item.costoTotal,
      item.usuarioNombre,
    ]);
  }

  sheet.autoFilter = "A5:I5";
  const widths = [20, 30, 16, 20, 12, 18, 15, 15, 22];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function handleWasteReportExport(
  record: Record<string, unknown>,
  context: ControllerContext,
  format: RestockExportFormat,
  dependencies: RestockExportDependencies,
): Promise<ControllerResponse<RestockExportResult>> {
  const role = effectiveSessionRole(context);
  if (role !== "dueno") {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "restock-report-export",
        message: "Operación restringida al rol Dueño.",
      },
    };
  }

  const request = normalizeWasteReportRequest(record);
  const validation = validateWasteReportRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "restock-report-export",
        message: validation.error,
      },
    };
  }

  const loadWaste = dependencies.loadWasteReport ?? queryWasteReportFromDb;
  const wasteData = await loadWaste(request);

  if (wasteData.items.length === 0) {
    return {
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        controllerId: "restock-report-export",
        message: WASTE_REPORT_EMPTY_MESSAGE,
      },
    };
  }

  const generatedAt = dependencies.now();
  const fechaGeneracion = generatedAt.toISOString();
  const extension = format;
  const dialogResult = await dependencies.showSaveDialog({
    title: "Guardar reporte de mermas",
    defaultPath: join(
      dependencies.documentsPath(),
      `Mermas_${request.fechaInicio}_al_${request.fechaTermino}_${formatFilenameDateInSantiago(generatedAt)}.${extension}`,
    ),
    filters: [
      {
        name: format === "pdf" ? "Documento PDF" : "Libro de Excel",
        extensions: [extension],
      },
    ],
  });

  if (dialogResult.canceled || !dialogResult.filePath) {
    return {
      ok: true,
      data: {
        formato: format,
        estado: "cancelled",
        cantidadFilas: wasteData.items.length,
        fechaGeneracion,
      },
    };
  }

  const printInput: WasteReportPrintInput = {
    fechaInicio: request.fechaInicio,
    fechaTermino: request.fechaTermino,
    fechaGeneracion: formatDateTimeInSantiago(generatedAt),
    items: wasteData.items,
    resumen: wasteData.resumen,
    usuario: context.claims?.usuarioId ?? "Dueño",
  };

  const createPdf = dependencies.createWastePdf ?? createWastePdfBuffer;
  const createXlsx = dependencies.createWasteXlsx ?? createWasteXlsxBuffer;

  const contents =
    format === "pdf"
      ? await createPdf(printInput)
      : await createXlsx(printInput);
  const outputPath = ensureExportExtension(dialogResult.filePath, format);
  await dependencies.save(outputPath, contents);

  const auditFn =
    dependencies.audit ?? ((ev) => registerAuditLog(db, appSchema, ev));
  await auditFn({
    usuarioId: context.claims?.usuarioId ?? "dueno",
    modulo: "reportes",
    tipoAccion: "exportar_reporte_mermas",
    descripcion: `Exportación de reporte de mermas (${format.toUpperCase()}) para el período ${request.fechaInicio} al ${request.fechaTermino}`,
  });

  return {
    ok: true,
    data: {
      formato: format,
      estado: "saved",
      ruta: outputPath,
      cantidadFilas: wasteData.items.length,
      fechaGeneracion,
    },
  };
}

export function renderExpiringLotsPrintHtml(
  input: ExpiringLotsReportPrintInput,
): string {
  const markup = renderToStaticMarkup(
    createElement(ReporteLotesVencerPrintView, input),
  );

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reporte de lotes próximos a vencer</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #17202a; font-family: Arial, sans-serif; font-size: 10pt; }
      h1 { margin: 0; color: #1b4332; font-size: 20pt; }
      h2 { margin: 4px 0 12px; font-size: 14pt; }
      .report-metadata { display: flex; gap: 32px; margin: 0 0 16px; }
      .report-metadata div { display: flex; gap: 6px; }
      dt { font-weight: 700; }
      dd { margin: 0; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th, td { border: 1px solid #aeb8c2; padding: 6px 8px; }
      th { background: #d8f3dc; color: #17202a; text-align: left; }
      tbody tr:nth-child(even) { background: #f6f7f9; }
      .numeric { text-align: right; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

export async function createExpiringLotsPdfBuffer(
  input: ExpiringLotsReportPrintInput,
  dependencies: PdfGenerationDependencies = defaultPdfGenerationDependencies,
): Promise<Buffer> {
  let window: HiddenPrintWindow | null = null;

  try {
    window = dependencies.createWindow();
    const html = renderExpiringLotsPrintHtml(input);
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    return await window.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

export async function createExpiringLotsXlsxBuffer(
  input: ExpiringLotsReportPrintInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Minimarket y Panadería Huáscar";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Lotes por Vencer", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").value = "Minimarket y Panadería Huáscar";
  sheet.getCell("A1").font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 16,
  };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B4332" },
  };

  sheet.mergeCells("A2:I2");
  sheet.getCell("A2").value =
    `Reporte de Lotes Próximos a Vencer — Horizonte: ${input.horizonte} días | Categoría: ${input.categoriaNombre ?? "Todas"}`;
  sheet.getCell("A2").font = { bold: true, size: 12 };

  sheet.mergeCells("A3:I3");
  sheet.getCell("A3").value =
    `Fecha de generación: ${input.fechaGeneracion} | Generado por: ${input.usuario}`;
  sheet.getCell("A3").font = { italic: true, size: 10 };

  sheet.addRow([]);

  const headerRow = sheet.addRow([
    "Producto",
    "EAN-13",
    "Categoría",
    "Proveedor",
    "Lote ID",
    "Unidades",
    "Vencimiento",
    "Días Restantes",
    "Costo Unitario",
    "Costo en Riesgo",
  ]);

  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD8F3DC" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFAEB8C2" } },
      bottom: { style: "thin", color: { argb: "FFAEB8C2" } },
      left: { style: "thin", color: { argb: "FFAEB8C2" } },
      right: { style: "thin", color: { argb: "FFAEB8C2" } },
    };
  });

  for (const item of input.items) {
    sheet.addRow([
      item.productoNombre,
      item.productoEan13,
      item.categoriaNombre,
      item.proveedorNombre ?? "Sin proveedor",
      item.loteId.slice(0, 8),
      item.cantidad,
      item.fechaVencimiento,
      item.diasRestantes,
      item.precioCosto,
      item.costoEnRiesgo,
    ]);
  }

  sheet.autoFilter = "A5:J5";
  const widths = [28, 16, 20, 24, 12, 12, 14, 14, 15, 16];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function handleExpiringLotsReportExport(
  record: Record<string, unknown>,
  context: ControllerContext,
  format: RestockExportFormat,
  dependencies: RestockExportDependencies,
): Promise<ControllerResponse<RestockExportResult>> {
  const role = effectiveSessionRole(context);
  if (role !== "dueno") {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "restock-report-export",
        message: "Operación restringida al rol Dueño.",
      },
    };
  }

  const request = normalizeExpiringLotsRequest(record);
  const validation = validateExpiringLotsRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "restock-report-export",
        message: validation.error,
      },
    };
  }

  const loadData =
    dependencies.loadExpiringLotsReport ?? queryExpiringLotsReportFromDb;
  const reportData = await loadData(request);

  if (reportData.items.length === 0) {
    return {
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        controllerId: "restock-report-export",
        message: EXPIRING_LOTS_EMPTY_MESSAGE,
      },
    };
  }

  const generatedAt = dependencies.now();
  const fechaGeneracion = generatedAt.toISOString();
  const extension = format;
  const parts = getSantiagoDateParts(generatedAt);
  const dateFormatted = `${parts.day}-${parts.month}-${parts.year}`;

  const dialogResult = await dependencies.showSaveDialog({
    title: "Guardar reporte de lotes próximos a vencer",
    defaultPath: join(
      dependencies.documentsPath(),
      `LotesPorVencer_Horizonte${reportData.horizonte}d_${dateFormatted}.${extension}`,
    ),
    filters: [
      {
        name: format === "pdf" ? "Documento PDF" : "Libro de Excel",
        extensions: [extension],
      },
    ],
  });

  if (dialogResult.canceled || !dialogResult.filePath) {
    return {
      ok: true,
      data: {
        formato: format,
        estado: "cancelled",
        cantidadFilas: reportData.items.length,
        fechaGeneracion,
      },
    };
  }

  const categoriaNombre = request.categoriaId
    ? reportData.categorias.find((c) => c.id === request.categoriaId)?.nombre
    : undefined;

  const printInput: ExpiringLotsReportPrintInput = {
    horizonte: reportData.horizonte,
    categoriaNombre,
    fechaGeneracion: formatDateTimeInSantiago(generatedAt),
    items: reportData.items,
    resumen: reportData.resumen,
    usuario: context.claims?.usuarioId ?? "Dueño",
  };

  const createPdf =
    dependencies.createExpiringLotsPdf ?? createExpiringLotsPdfBuffer;
  const createXlsx =
    dependencies.createExpiringLotsXlsx ?? createExpiringLotsXlsxBuffer;

  const contents =
    format === "pdf"
      ? await createPdf(printInput)
      : await createXlsx(printInput);

  const outputPath = ensureExportExtension(dialogResult.filePath, format);
  await dependencies.save(outputPath, contents);

  const auditLogger =
    dependencies.audit ??
    ((event) => registerAuditLog(db, appSchema, event));
  await auditLogger({
    usuarioId: context.claims?.usuarioId ?? "system",
    modulo: "reportes",
    tipoAccion: "exportar_reporte_lotes_por_vencer",
    descripcion: `Exportación de reporte de lotes próximos a vencer (${format.toUpperCase()}) horizonte ${reportData.horizonte} días`,
  });

  return {
    ok: true,
    data: {
      formato: format,
      estado: "saved",
      ruta: outputPath,
      cantidadFilas: reportData.items.length,
      fechaGeneracion,
    },
  };
}

export function renderMovementPrintHtml(
  input: MovementReportPrintInput,
): string {
  const markup = renderToStaticMarkup(
    createElement(ReporteMovimientosPrintView, input),
  );

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reporte de auditoría de movimientos de inventario</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #17202a; font-family: Arial, sans-serif; font-size: 10pt; }
      h1 { margin: 0; color: #1b4332; font-size: 20pt; }
      h2 { margin: 4px 0 12px; font-size: 14pt; }
      .report-metadata { display: flex; flex-wrap: wrap; gap: 24px; margin: 0 0 16px; }
      .report-metadata div { display: flex; gap: 6px; }
      dt { font-weight: 700; }
      dd { margin: 0; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th, td { border: 1px solid #aeb8c2; padding: 6px 8px; }
      th { background: #d8f3dc; color: #17202a; text-align: left; }
      tbody tr:nth-child(even) { background: #f6f7f9; }
      .numeric { text-align: right; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

export async function createMovementPdfBuffer(
  input: MovementReportPrintInput,
  dependencies: PdfGenerationDependencies = defaultPdfGenerationDependencies,
): Promise<Buffer> {
  let window: HiddenPrintWindow | null = null;

  try {
    window = dependencies.createWindow();
    const html = renderMovementPrintHtml(input);
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    return await window.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

export async function createMovementXlsxBuffer(
  input: MovementReportPrintInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Minimarket y Panadería Huáscar";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Movimientos Inventario", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  sheet.mergeCells("A1:J1");
  sheet.getCell("A1").value = "Minimarket y Panadería Huáscar";
  sheet.getCell("A1").font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 16,
  };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B4332" },
  };

  sheet.mergeCells("A2:J2");
  sheet.getCell("A2").value =
    `Reporte de Auditoría de Movimientos de Inventario — Período: ${input.fechaInicio} al ${input.fechaTermino} | Tipo: ${input.tipoNombre ?? "Todos"} | Categoría: ${input.categoriaNombre ?? "Todas"} | Usuario: ${input.usuarioFiltroNombre ?? "Todos"}`;
  sheet.getCell("A2").font = { bold: true, size: 11 };

  sheet.mergeCells("A3:J3");
  sheet.getCell("A3").value =
    `Fecha de generación: ${input.fechaGeneracion} | Generado por: ${input.usuario}`;
  sheet.getCell("A3").font = { italic: true, size: 10 };

  sheet.addRow([]);

  const headerRow = sheet.addRow([
    "Fecha y Hora",
    "Producto",
    "EAN-13",
    "Categoría",
    "Tipo Movimiento",
    "Cantidad",
    "Saldo Resultante",
    "Lote ID",
    "Descripción / Motivo",
    "Responsable",
  ]);

  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD8F3DC" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFAEB8C2" } },
      bottom: { style: "thin", color: { argb: "FFAEB8C2" } },
      left: { style: "thin", color: { argb: "FFAEB8C2" } },
      right: { style: "thin", color: { argb: "FFAEB8C2" } },
    };
  });

  for (const item of input.items) {
    sheet.addRow([
      item.fechaHora,
      item.productoNombre,
      item.productoEan13,
      item.categoriaNombre,
      item.tipoLabel,
      item.cantidad,
      item.saldo,
      item.loteId ? item.loteId.slice(0, 8) : "-",
      item.descripcion,
      item.usuarioNombre,
    ]);
  }

  sheet.autoFilter = "A5:J5";
  const widths = [20, 28, 16, 20, 18, 12, 16, 12, 32, 24];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function handleMovementReportExport(
  record: Record<string, unknown>,
  context: ControllerContext,
  format: RestockExportFormat,
  dependencies: RestockExportDependencies,
): Promise<ControllerResponse<RestockExportResult>> {
  const role = effectiveSessionRole(context);
  if (role !== "dueno") {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "restock-report-export",
        message: "Operación restringida al rol Dueño.",
      },
    };
  }

  const request = normalizeMovementReportRequest(record);
  const validation = validateMovementReportRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "restock-report-export",
        message: validation.error,
      },
    };
  }

  const loadData =
    dependencies.loadMovementReport ?? queryMovementReportFromDb;
  const reportData = await loadData(request);

  if (reportData.items.length === 0) {
    return {
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        controllerId: "restock-report-export",
        message: MOVEMENT_REPORT_EMPTY_MESSAGE,
      },
    };
  }

  const generatedAt = dependencies.now();
  const fechaGeneracion = generatedAt.toISOString();
  const extension = format;
  const parts = getSantiagoDateParts(generatedAt);
  const dateFormatted = `${parts.day}-${parts.month}-${parts.year}`;

  const dialogResult = await dependencies.showSaveDialog({
    title: "Guardar reporte de movimientos de inventario",
    defaultPath: join(
      dependencies.documentsPath(),
      `MovimientosInventario_${request.fechaInicio}_al_${request.fechaTermino}_${dateFormatted}.${extension}`,
    ),
    filters: [
      {
        name: format === "pdf" ? "Documento PDF" : "Libro de Excel",
        extensions: [extension],
      },
    ],
  });

  if (dialogResult.canceled || !dialogResult.filePath) {
    return {
      ok: true,
      data: {
        formato: format,
        estado: "cancelled",
        cantidadFilas: reportData.items.length,
        fechaGeneracion,
      },
    };
  }

  const tipoNombre = request.tipo
    ? MOVEMENT_TYPE_LABELS[request.tipo]
    : undefined;
  const categoriaNombre = request.categoriaId
    ? reportData.categorias.find((c) => c.id === request.categoriaId)?.nombre
    : undefined;
  const usuarioFiltroNombre = request.usuarioId
    ? reportData.usuarios.find((u) => u.id === request.usuarioId)?.nombre
    : undefined;

  const printInput: MovementReportPrintInput = {
    fechaInicio: request.fechaInicio,
    fechaTermino: request.fechaTermino,
    tipoNombre,
    categoriaNombre,
    usuarioFiltroNombre,
    fechaGeneracion: formatDateTimeInSantiago(generatedAt),
    items: reportData.items,
    resumen: reportData.resumen,
    usuario: context.claims?.usuarioId ?? "Dueño",
  };

  const createPdf =
    dependencies.createMovementPdf ?? createMovementPdfBuffer;
  const createXlsx =
    dependencies.createMovementXlsx ?? createMovementXlsxBuffer;

  const contents =
    format === "pdf"
      ? await createPdf(printInput)
      : await createXlsx(printInput);

  const outputPath = ensureExportExtension(dialogResult.filePath, format);
  await dependencies.save(outputPath, contents);

  const auditLogger =
    dependencies.audit ??
    ((event) => registerAuditLog(db, appSchema, event));
  await auditLogger({
    usuarioId: context.claims?.usuarioId ?? "dueno",
    modulo: "reportes",
    tipoAccion: "exportar_reporte_movimientos_inventario",
    descripcion: `Exportación de reporte de auditoría de movimientos de inventario (${format.toUpperCase()}) para el período ${request.fechaInicio} al ${request.fechaTermino}`,
  });

  return {
    ok: true,
    data: {
      formato: format,
      estado: "saved",
      ruta: outputPath,
      cantidadFilas: reportData.items.length,
      fechaGeneracion,
    },
  };
}

const restockExportDependencies: RestockExportDependencies = {
  load: (request, sessionRole) =>
    loadAuthorizedRestockList(request, sessionRole),
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  createPdf: (input) => createRestockPdfBuffer(input),
  createXlsx: (input) => createRestockXlsxBuffer(input),
  save: (path, contents) => writeFile(path, contents),
  now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
  loadWasteReport: queryWasteReportFromDb,
  createWastePdf: createWastePdfBuffer,
  createWasteXlsx: createWasteXlsxBuffer,
  loadExpiringLotsReport: queryExpiringLotsReportFromDb,
  createExpiringLotsPdf: createExpiringLotsPdfBuffer,
  createExpiringLotsXlsx: createExpiringLotsXlsxBuffer,
  loadMovementReport: queryMovementReportFromDb,
  createMovementPdf: createMovementPdfBuffer,
  createMovementXlsx: createMovementXlsxBuffer,
  audit: (event) => registerAuditLog(db, appSchema, event),
};

export const restockReportExportController =
  createRestockReportExportController();
