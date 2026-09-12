import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../../src/main/controllers/auth-context";
import {
  createRestockPdfBuffer,
  createRestockReportExportController,
  createRestockXlsxBuffer,
  formatDateTimeInSantiago,
  formatFilenameDateInSantiago,
  renderRestockPrintHtml,
  type HiddenPrintWindow,
  type RestockExportDependencies,
  type RestockReportInput,
} from "../../../src/main/controllers/restock-report-export";
import { RESTOCK_EXPORT_ERROR_MESSAGE } from "../../../src/shared/restock";

const items = [
  {
    nombre: "Leche <entera> & fresca",
    ean13: "7800000000001",
    categoria: "Lácteos",
    stockActual: 2,
    stockMinimo: 5,
    cantidadSugerida: 8,
  },
];

const user: AuthenticatedUser = {
  role: "trabajador",
  usuarioId: "worker",
  usuarioRol: "trabajador",
  trabajadorNombre: "Camila Rojas",
};

const reportInput: RestockReportInput = {
  fecha: "12-09-2026 20:30",
  items,
  usuario: user.trabajadorNombre,
};

function dependencies(
  overrides: Partial<RestockExportDependencies> = {},
): RestockExportDependencies {
  return {
    load: vi.fn(async () => ({ items, user })),
    showSaveDialog: vi.fn(async () => ({
      canceled: false,
      filePath: "C:/Documentos/lista.pdf",
    })),
    createPdf: vi.fn(async () => Buffer.from("%PDF-test")),
    createXlsx: vi.fn(async () => Buffer.from("xlsx")),
    save: vi.fn(async () => undefined),
    now: () => new Date("2026-09-12T23:30:00.000Z"),
    documentsPath: () => "C:/Documentos",
    ...overrides,
  };
}

describe("CU16 report export controller (C33)", () => {
  it("ignores renderer rows and paths, recalculates and saves the selected format", async () => {
    const deps = dependencies();
    const controller = createRestockReportExportController(deps);
    const response = await controller.handle(
      {
        usuarioId: "worker",
        filas: [{ nombre: "Inyectado" }],
        ruta: "C:/ataque.xlsx",
        encabezados: ["Inyectado"],
      },
      { channel: "reporte:exportar-pdf" },
    );

    expect(deps.load).toHaveBeenCalledWith({ usuarioId: "worker" }, undefined);
    expect(deps.createPdf).toHaveBeenCalledWith(reportInput);
    expect(deps.createXlsx).not.toHaveBeenCalled();
    expect(deps.save).toHaveBeenCalledWith(
      "C:/Documentos/lista.pdf",
      Buffer.from("%PDF-test"),
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        formato: "pdf",
        estado: "saved",
        ruta: "C:/Documentos/lista.pdf",
        cantidadFilas: 1,
      },
    });
  });

  it("recalculates on every export invocation", async () => {
    const deps = dependencies({
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
    });
    const controller = createRestockReportExportController(deps);

    await controller.handle(
      { usuarioId: "worker" },
      { channel: "reporte:exportar-pdf" },
    );
    await controller.handle(
      { usuarioId: "worker" },
      { channel: "reporte:exportar-xlsx" },
    );

    expect(deps.load).toHaveBeenCalledTimes(2);
  });

  it("returns BUSINESS_RULE before the dialog when the recalculated list is empty", async () => {
    const deps = dependencies({
      load: vi.fn(async () => ({ items: [], user })),
    });
    const controller = createRestockReportExportController(deps);
    const response = await controller.handle(
      { usuarioId: "worker" },
      { channel: "reporte:exportar-pdf" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE" },
    });
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
  });

  it("treats dialog cancellation as a normal result without a file", async () => {
    const deps = dependencies({
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
    });
    const controller = createRestockReportExportController(deps);
    const response = await controller.handle(
      { usuarioId: "worker" },
      { channel: "reporte:exportar-xlsx" },
    );

    expect(response).toMatchObject({
      ok: true,
      data: { formato: "xlsx", estado: "cancelled", cantidadFilas: 1 },
    });
    expect(deps.createXlsx).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it.each(["load", "createPdf", "createXlsx", "save"] as const)(
    "maps a %s failure to the exact E2 message",
    async (stage) => {
      const overrides: Partial<RestockExportDependencies> = {};
      if (stage === "load") overrides.load = vi.fn(async () => { throw new Error("query"); });
      if (stage === "createPdf") overrides.createPdf = vi.fn(async () => { throw new Error("pdf"); });
      if (stage === "createXlsx") overrides.createXlsx = vi.fn(async () => { throw new Error("xlsx"); });
      if (stage === "save") overrides.save = vi.fn(async () => { throw new Error("write"); });
      const controller = createRestockReportExportController(
        dependencies(overrides),
      );

      await expect(
        controller.handle(
          { usuarioId: "worker" },
          {
            channel:
              stage === "createXlsx"
                ? "reporte:exportar-xlsx"
                : "reporte:exportar-pdf",
          },
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: "TECHNICAL_ERROR",
          message: RESTOCK_EXPORT_ERROR_MESSAGE,
        },
      });
    },
  );

  it("rejects invalid channels", async () => {
    const response = await createRestockReportExportController(
      dependencies(),
    ).handle({}, { channel: "reporte:otro" });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });
});

describe("CU16 generated report files", () => {
  it("escapes HTML and provides multipage printable structure", () => {
    const html = renderRestockPrintHtml(reportInput);
    expect(html).toContain("Minimarket y Panadería Huáscar");
    expect(html).toContain("12-09-2026 20:30");
    expect(html).toContain("Camila Rojas");
    expect(html).toContain("Leche &lt;entera&gt; &amp; fresca");
    expect(html).not.toContain("Leche <entera>");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("@page { size: A4 landscape;");
  });

  it("always destroys the isolated PDF window, including print failure", async () => {
    const destroy = vi.fn();
    const printToPDF = vi.fn(async () => {
      throw new Error("print failed");
    });
    const printWindow: HiddenPrintWindow = {
      destroy,
      isDestroyed: () => false,
      loadURL: vi.fn(async () => undefined),
      webContents: { printToPDF },
    };

    await expect(
      createRestockPdfBuffer(reportInput, {
        createWindow: () => printWindow,
      }),
    ).rejects.toThrow("print failed");
    expect(printWindow.loadURL).toHaveBeenCalledWith(
      expect.stringMatching(/^data:text\/html;charset=utf-8,/),
    );
    expect(printToPDF).toHaveBeenCalledWith({
      landscape: true,
      pageSize: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("creates a readable XLSX with metadata, numeric values and table features", async () => {
    const buffer = await createRestockXlsxBuffer(reportInput);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("Reabastecimiento");

    expect(sheet).toBeDefined();
    expect(sheet!.getCell("A1").value).toBe("Minimarket y Panadería Huáscar");
    expect(sheet!.getCell("A2").value).toBe(
      "Fecha de generación: 12-09-2026 20:30",
    );
    expect(sheet!.getCell("A3").value).toBe("Usuario: Camila Rojas");
    expect(sheet!.getRow(5).values).toEqual([
      undefined,
      "Producto",
      "EAN-13",
      "Categoría",
      "Stock actual",
      "Stock mínimo",
      "Cantidad sugerida",
    ]);
    expect(sheet!.getCell("D6").value).toBe(2);
    expect(typeof sheet!.getCell("D6").value).toBe("number");
    expect(sheet!.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(sheet!.autoFilter).toBe("A5:F5");
  });

  it("formats the report time and filename in America/Santiago", () => {
    const instant = new Date("2026-09-12T23:30:00.000Z");
    expect(formatDateTimeInSantiago(instant)).toBe("12-09-2026 20:30");
    expect(formatFilenameDateInSantiago(instant)).toBe("2026-09-12_20-30");
  });
});
