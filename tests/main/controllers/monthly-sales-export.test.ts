import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { createMonthlySalesPdf, createMonthlySalesXlsx, renderMonthlySalesPrintHtml } from "../../../src/main/controllers/monthly-sales-export";
import { MONTHLY_SALES_EMPTY_MESSAGE } from "../../../src/shared/monthly-sales";
import { report, user } from "./report-export-fixture";
const input = { report, usuario: user.trabajadorNombre, fecha: "30-09-2026 10:00" };

describe("constructores de CU47 reutilizados por CU54", () => {
  it("incluye el gráfico como imagen, todos los días e identidad escapada en el HTML de impresión", () => {
    const html = renderMonthlySalesPrintHtml(input);
    expect(html).toContain('src="data:image/svg+xml');
    expect(html).toContain("30/09/2026");
    expect(html).toContain("Ana &lt;Dueña&gt;");
    expect(html).toContain("N/A");
    expect(html).not.toContain(MONTHLY_SALES_EMPTY_MESSAGE);
  });

  it("crea un libro con todos los valores diarios y métodos de pago, sin imagen incrustada", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createMonthlySalesXlsx(input) as any);
    const sheet = workbook.getWorksheet("Ventas mensuales")!;
    expect(sheet.getCell("A1").value).toBe("Minimarket y Panadería Huáscar");
    expect(sheet.getCell("C6").value).toBe(2500);
    expect(sheet.getCell("C8").value).toBe("N/A");
    expect(sheet.getCell("A11").value).toBe("01/09/2026");
    expect(sheet.getCell("C12").value).toBe(0);
    expect(sheet.getCell("A40").value).toBe("30/09/2026");
    expect(sheet.getImages()).toEqual([]);
  });

  it("cierra su ventana PDF oculta ante un fallo de renderizado", async () => {
    const destroy = vi.fn();
    await expect(createMonthlySalesPdf(input, () => ({ loadURL: async () => undefined, isDestroyed: () => false, destroy, webContents: { printToPDF: async () => { throw new Error("Print failed"); } } }))).rejects.toThrow("Print failed");
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
