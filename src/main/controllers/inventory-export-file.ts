import { BrowserWindow, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INVENTORY_EXPORT_COLUMNS,
  type InventoryExportFormat,
  type InventoryReportInput,
} from "../../shared/inventory-export";
import { ReportePrintView } from "../../renderer/src/components/ReportePrintView";
import {
  formatFilenameDateInSantiago,
  type PdfGenerationDependencies,
} from "./restock-report-export";

export function buildInventorySaveDialogOptions(
  format: InventoryExportFormat,
  date: Date,
  directory: string,
): SaveDialogOptions {
  return {
    title: "Guardar listado de inventario",
    defaultPath: join(
      directory,
      `listado-inventario-${formatFilenameDateInSantiago(date)}.${format}`,
    ),
    filters: [
      {
        name: format === "pdf" ? "Documento PDF" : "Libro de Excel",
        extensions: [format],
      },
    ],
  };
}

export function renderInventoryPrintHtml(input: InventoryReportInput): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>Listado de inventario</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; } body { margin: 0; color: #17202a; font: 9pt Arial, sans-serif; }
    h1 { margin: 0; color: #1b4332; font-size: 18pt; } h2 { margin: 5px 0 12px; font-size: 13pt; }
    .report-metadata { display: flex; gap: 28px; margin: 0 0 16px; }
    .report-metadata div { display: flex; gap: 6px; } dt { font-weight: bold; } dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    th, td { border: 1px solid #aeb8c2; padding: 5px; overflow-wrap: anywhere; }
    th { background: #d8f3dc; text-align: left; } tbody tr:nth-child(even) { background: #f6f7f9; }
    .numeric { text-align: right; } .ean { white-space: nowrap; font-size: 8pt; }
    </style></head><body>${renderToStaticMarkup(createElement(ReportePrintView, input))}</body></html>`;
}

export async function createInventoryPdfBuffer(
  input: InventoryReportInput,
  dependencies: PdfGenerationDependencies = {
    createWindow: () =>
      new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      }),
  },
): Promise<Buffer> {
  const window = dependencies.createWindow();
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(renderInventoryPrintHtml(input))}`,
    );
    return await window.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function createInventoryXlsxBuffer(
  input: InventoryReportInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.negocio;
  workbook.created = new Date(input.fechaGeneracion);
  const sheet = workbook.addWorksheet("Inventario", {
    views: [{ state: "frozen", ySplit: 6 }],
  });
  for (const [index, value] of [
    input.negocio,
    "Listado de inventario",
    `Fecha de exportación: ${input.fecha}`,
    `Usuario: ${input.usuario}`,
  ].entries()) {
    sheet.mergeCells(index + 1, 1, index + 1, 8);
    sheet.getCell(index + 1, 1).value = value;
  }
  sheet.getCell("A1").font = {
    bold: true,
    size: 16,
    color: { argb: "FFFFFFFF" },
  };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B4332" },
  };
  sheet.getRow(1).height = 26;
  sheet.getRow(6).values = [...INVENTORY_EXPORT_COLUMNS];
  sheet.getRow(6).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(6).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2D6A4F" },
  };
  for (const item of input.items) {
    const row = sheet.addRow([
      item.ean13,
      item.nombre,
      item.categoria,
      item.stockActual,
      item.stockMinimo,
      item.precioCosto,
      item.precioVenta,
      item.estado,
    ]);
    row.getCell(1).numFmt = "@";
    for (const column of [4, 5]) row.getCell(column).numFmt = "0";
    for (const column of [6, 7]) row.getCell(column).numFmt = '"$"#,##0';
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
  }
  [18, 38, 26, 15, 15, 18, 18, 13].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.autoFilter = "A6:H6";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export type DestinationDependencies = {
  exists: (path: string) => Promise<boolean>;
  confirm: (path: string) => Promise<boolean>;
};
/** El diálogo ya confirmó selectedPath; confirmar de nuevo sólo si cambió el destino. */
export async function confirmInventoryDestination(
  outputPath: string,
  selectedPath: string,
  dependencies: DestinationDependencies = {
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    confirm: async (path) =>
      (
        await dialog.showMessageBox({
          type: "question",
          title: "Reemplazar archivo",
          message: `Ya existe ${basename(path)}. ¿Desea reemplazarlo?`,
          detail: path,
          buttons: ["Reemplazar", "Cancelar"],
          defaultId: 1,
          cancelId: 1,
        })
      ).response === 0,
  },
): Promise<boolean> {
  return (
    outputPath === selectedPath ||
    !(await dependencies.exists(outputPath)) ||
    dependencies.confirm(outputPath)
  );
}

export type InventoryFileDependencies = {
  openTemp: (
    path: string,
  ) => Promise<{
    writeFile: (contents: Buffer) => Promise<void>;
    close: () => Promise<void>;
  }>;
  replace: (source: string, destination: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  token: () => string;
  logCleanup: (error: unknown) => void;
};
export async function saveInventoryFile(
  path: string,
  contents: Buffer,
  dependencies: InventoryFileDependencies = {
    openTemp: (path) => open(path, "wx"),
    replace: rename,
    remove: unlink,
    token: randomUUID,
    logCleanup: (error) =>
      log.error(
        "[CU20] Fallo al limpiar archivo temporal",
        technicalErrorDetails(error),
      ),
  },
): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${dependencies.token()}.tmp`,
  );
  let handle: Awaited<
    ReturnType<InventoryFileDependencies["openTemp"]>
  > | null = null;
  let created = false;
  let saved = false;
  try {
    handle = await dependencies.openTemp(temporaryPath);
    created = true;
    await handle.writeFile(contents);
    await handle.close();
    handle = null;
    await dependencies.replace(temporaryPath, path);
    saved = true;
  } finally {
    if (handle) await handle.close().catch(dependencies.logCleanup);
    if (created && !saved)
      await dependencies.remove(temporaryPath).catch(dependencies.logCleanup);
  }
}

/** No incluir payloads, tokens, URLs de conexión ni mensajes de drivers. */
export function technicalErrorDetails(error: unknown): {
  name: string;
  code?: string;
} {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined,
  };
}
