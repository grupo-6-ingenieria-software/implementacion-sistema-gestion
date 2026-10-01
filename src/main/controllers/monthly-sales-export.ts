import { BrowserWindow } from "electron";
import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  paymentMethodLabels,
} from "../../shared/monthly-sales";
import { ReporteMensualVentasPrintView, monthlySalesPrintHeader, type MonthlySalesPrintInput } from "../../renderer/src/components/ReporteMensualVentasPrintView";
import { type HiddenPrintWindow } from "./restock-report-export";

export function renderMonthlySalesPrintHtml(input: MonthlySalesPrintInput): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Reporte mensual de ventas</title><style>
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
  const header = monthlySalesPrintHeader(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = header.usuario;
  const sheet = workbook.addWorksheet("Ventas mensuales", { views: [{ state: "frozen", ySplit: 10 }] });
  const headings = [header.negocio, header.tipo, `Período: ${header.periodo}`, `Generado: ${header.fecha}`, `Usuario: ${header.usuario}`];
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
