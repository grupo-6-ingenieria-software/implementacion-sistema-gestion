import ExcelJS from "exceljs";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildInventorySaveDialogOptions,
  confirmInventoryDestination,
  createInventoryPdfBuffer,
  createInventoryXlsxBuffer,
  renderInventoryPrintHtml,
  saveInventoryFile,
  technicalErrorDetails,
} from "../../../src/main/controllers/inventory-export-file";
import {
  INVENTORY_BUSINESS_NAME,
  INVENTORY_EXPORT_COLUMNS,
  type InventoryReportInput,
} from "../../../src/shared/inventory-export";
import { formatDateTimeInSantiago } from "../../../src/main/controllers/restock-report-export";

const input: InventoryReportInput = {
  negocio: INVENTORY_BUSINESS_NAME,
  fecha: "12-09-2026 20:30",
  fechaGeneracion: "2026-09-12T23:30:00Z",
  usuario: "Camila <Rojas>",
  items: [
    {
      productoId: 1,
      ean13: "0000000000001",
      nombre: "=SUM(A1:A2) <script> & leche",
      categoria: "Lácteos",
      stockActual: 7,
      stockMinimo: 4,
      precioCosto: 80,
      precioVenta: 150,
      estado: "inactivo",
    },
  ],
};

describe("archivos y presentación de CU20 (T05/T06/T07)", () => {
  it("escribe las ocho columnas con EAN como texto, números reales y cadenas inertes", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createInventoryXlsxBuffer(input)) as unknown as ExcelJS.Buffer,
    );
    const sheet = workbook.getWorksheet("Inventario")!;
    expect(sheet.rowCount).toBe(7);
    expect(sheet.getRow(6).values).toEqual([
      undefined,
      ...INVENTORY_EXPORT_COLUMNS,
    ]);
    expect(sheet.getRow(7).values).toEqual([
      undefined,
      "0000000000001",
      input.items[0].nombre,
      "Lácteos",
      7,
      4,
      80,
      150,
      "inactivo",
    ]);
    expect(sheet.getCell("A7").numFmt).toBe("@");
    expect(sheet.getCell("B7").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("F7").type).toBe(ExcelJS.ValueType.Number);
    expect(sheet.getCell("A1").value).toBe(input.negocio);
    expect(sheet.getCell("A3").value).toContain(input.fecha);
    expect(sheet.getCell("A4").value).toContain(input.usuario);
    expect(workbook.created.toISOString()).toBe(
      input.fechaGeneracion.replace("Z", ".000Z"),
    );
  });
  it("escapa HTML, conserva el EAN y proporciona encabezados de impresión repetidos", () => {
    const html = renderInventoryPrintHtml(input);
    for (const header of INVENTORY_EXPORT_COLUMNS)
      expect(html).toContain(header);
    expect(html).toContain("&lt;script&gt; &amp; leche");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Camila &lt;Rojas&gt;");
    expect(html).toContain("0000000000001");
    expect(html).toContain("table-header-group");
    expect(html).toContain("A4 landscape");
  });
  it.each(["success", "load", "print"])(
    "destruye la ventana PDF aislada tras %s",
    async (mode) => {
      const window = {
        destroy: vi.fn(),
        isDestroyed: () => false,
        loadURL: vi.fn(async () => {
          if (mode === "load") throw new Error("load");
        }),
        webContents: {
          printToPDF: vi.fn(async () => {
            if (mode === "print") throw new Error("print");
            return Buffer.from("%PDF");
          }),
        },
      };
      const action = createInventoryPdfBuffer(input, {
        createWindow: () => window,
      });
      if (mode === "success") {
        expect(await action).toEqual(Buffer.from("%PDF"));
        expect(window.webContents.printToPDF).toHaveBeenCalledWith({
          landscape: true,
          pageSize: "A4",
          preferCSSPageSize: true,
          printBackground: true,
        });
      } else await expect(action).rejects.toThrow(mode);
      expect(window.destroy).toHaveBeenCalledOnce();
    },
  );
  it("usa fechas de Santiago a través de la medianoche y desfases de verano/invierno", () => {
    expect(formatDateTimeInSantiago(new Date("2026-07-01T03:30:00Z"))).toBe(
      "30-06-2026 23:30",
    );
    expect(formatDateTimeInSantiago(new Date("2026-12-01T03:30:00Z"))).toBe(
      "01-12-2026 00:30",
    );
    expect(
      buildInventorySaveDialogOptions(
        "xlsx",
        new Date(input.fechaGeneracion),
        "C:/Documentos",
      ).defaultPath,
    ).toContain("listado-inventario-2026-09-12_20-30.xlsx");
  });
  it("no filtra mensajes del driver ni credenciales a los registros técnicos", () => {
    const error = Object.assign(
      new Error("token=secret https://private-driver"),
      { code: "EACCES" },
    );
    expect(technicalErrorDetails(error)).toEqual({
      name: "Error",
      code: "EACCES",
    });
  });
});

describe("destino y guardado atómico de CU20 (T11)", () => {
  it("confirma un destino normalizado distinto cuando ya existe", async () => {
    const dependencies = {
      exists: vi.fn(async () => true),
      confirm: vi.fn(async () => false),
    };
    expect(
      await confirmInventoryDestination("file.xlsx", "file.pdf", dependencies),
    ).toBe(false);
    expect(dependencies.confirm).toHaveBeenCalledWith("file.xlsx");
    expect(
      await confirmInventoryDestination("file.xlsx", "file.xlsx", dependencies),
    ).toBe(true);
    expect(dependencies.confirm).toHaveBeenCalledOnce();
    dependencies.exists.mockResolvedValue(false);
    expect(
      await confirmInventoryDestination("new.xlsx", "new", dependencies),
    ).toBe(true);
  });
  it.each(["success", "write", "replace"])(
    "conserva/confirma el destino y limpia los archivos temporales tras %s",
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "cu20-save-"));
      try {
        const path = join(directory, "inventory.xlsx");
        await writeFile(path, "previous");
        if (mode === "success")
          await saveInventoryFile(path, Buffer.from("new"));
        else {
          await expect(
            saveInventoryFile(path, Buffer.from("new"), {
              token: () => "test",
              openTemp: async (temporary) => {
                const handle = await open(temporary, "wx");
                return {
                  close: () => handle.close(),
                  writeFile: async (contents) => {
                    await handle.writeFile(contents);
                    if (mode === "write") throw new Error("write failed");
                  },
                };
              },
              replace: async () => {
                throw new Error("replace failed");
              },
              remove: unlink,
              logCleanup: vi.fn(),
            }),
          ).rejects.toThrow(`${mode} failed`);
        }
        expect(await readFile(path, "utf8")).toBe(
          mode === "success" ? "new" : "previous",
        );
        expect(await readdir(directory)).toEqual(["inventory.xlsx"]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("no elimina un archivo temporal ajeno cuando falla la apertura exclusiva", async () => {
    const remove = vi.fn();
    await expect(
      saveInventoryFile("inventory.pdf", Buffer.from("pdf"), {
        token: () => "collision",
        openTemp: async () => {
          throw new Error("EEXIST");
        },
        replace: vi.fn(),
        remove,
        logCleanup: vi.fn(),
      }),
    ).rejects.toThrow("EEXIST");
    expect(remove).not.toHaveBeenCalled();
  });
  it("registra los fallos de limpieza conservando el fallo original de exportación", async () => {
    const logCleanup = vi.fn();
    await expect(
      saveInventoryFile("inventory.pdf", Buffer.from("pdf"), {
        token: () => "test",
        openTemp: async () => ({
          writeFile: async () => {
            throw new Error("write failed");
          },
          close: async () => undefined,
        }),
        replace: vi.fn(),
        remove: async () => {
          throw new Error("cleanup failed");
        },
        logCleanup,
      }),
    ).rejects.toThrow("write failed");
    expect(logCleanup).toHaveBeenCalledOnce();
  });
});
