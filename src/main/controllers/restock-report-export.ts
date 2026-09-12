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

const restockExportDependencies: RestockExportDependencies = {
  load: (request, sessionRole) =>
    loadAuthorizedRestockList(request, sessionRole),
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  createPdf: (input) => createRestockPdfBuffer(input),
  createXlsx: (input) => createRestockXlsxBuffer(input),
  save: (path, contents) => writeFile(path, contents),
  now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
};

export const restockReportExportController =
  createRestockReportExportController();
