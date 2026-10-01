import { describe, expect, it, vi } from "vitest";
import {
  createWasteReportController,
  type WasteReportDependencies,
} from "../../../src/main/controllers/waste-report";
import { createRestockReportExportController } from "../../../src/main/controllers/restock-report-export";
import type { ControllerContext } from "../../../src/main/controllers/base";
import type {
  WasteReportData,
  WasteReportRequest,
} from "../../../src/shared/report-waste";
import {
  WASTE_REPORT_DATE_RANGE_ERROR,
  WASTE_REPORT_INVALID_DATE_ERROR,
} from "../../../src/shared/report-waste";

const sampleReportData: WasteReportData = {
  fechaInicio: "2026-09-01",
  fechaTermino: "2026-09-15",
  items: [
    {
      id: "ml-1",
      fechaHora: "2026-09-10 14:00:00",
      productoNombre: "Leche Entera 1L",
      productoEan13: "7802920000015",
      categoriaNombre: "Lácteos",
      cantidad: 3,
      motivo: "vencimiento",
      usuarioNombre: "Juan Pérez",
      loteId: "lote-1",
      costoUnitario: 800,
      costoTotal: 2400,
    },
    {
      id: "ml-2",
      fechaHora: "2026-09-11 10:30:00",
      productoNombre: "Yogurt Frutilla 125g",
      productoEan13: "7802920000022",
      categoriaNombre: "Lácteos",
      cantidad: 2,
      motivo: "dano",
      usuarioNombre: "Juan Pérez",
      loteId: "lote-2",
      costoUnitario: 300,
      costoTotal: 600,
    },
  ],
  resumen: {
    unidadesPorMotivo: {
      vencimiento: 3,
      dano: 2,
      robo: 0,
      error_registro: 0,
    },
    totalUnidades: 5,
    costoTotal: 3000,
  },
};

function createMockDeps(
  overrides: Partial<WasteReportDependencies> = {},
): WasteReportDependencies {
  return {
    queryWasteReport: vi.fn(async (_req: WasteReportRequest) => sampleReportData),
    ...overrides,
  };
}

function createContext(
  role: "dueno" | "trabajador" = "dueno",
  channel = "reporte:mermas",
): ControllerContext {
  return {
    channel,
    claims: {
      usuarioId: "user-1",
      rol: role,
      usuarioRol: role,
      passwordTemporal: false,
      sesionId: "sesion-1",
    },
  };
}

describe("CU49 Reporte de mermas (C56 ReporteMermasHandler)", () => {
  it("rejects unregistered IPC channels", async () => {
    const deps = createMockDeps();
    const controller = createWasteReportController(deps);
    const response = await controller.handle(
      { fechaInicio: "2026-09-01", fechaTermino: "2026-09-15" },
      createContext("dueno", "reporte:otro"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "INVALID_CHANNEL",
        controllerId: "waste-report",
        message: "Canal IPC no registrado: reporte:otro",
      },
    });
    expect(deps.queryWasteReport).not.toHaveBeenCalled();
  });

  it("denies access to trabajador role (CU49 restricted to dueno)", async () => {
    const deps = createMockDeps();
    const controller = createWasteReportController(deps);
    const response = await controller.handle(
      { fechaInicio: "2026-09-01", fechaTermino: "2026-09-15" },
      createContext("trabajador"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "waste-report",
        message: "Operación restringida al rol Dueño.",
      },
    });
    expect(deps.queryWasteReport).not.toHaveBeenCalled();
  });

  it("rejects invalid date formats", async () => {
    const deps = createMockDeps();
    const controller = createWasteReportController(deps);
    const response = await controller.handle(
      { fechaInicio: "invalido", fechaTermino: "2026-09-15" },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "waste-report",
        message: WASTE_REPORT_INVALID_DATE_ERROR,
      },
    });
    expect(deps.queryWasteReport).not.toHaveBeenCalled();
  });

  it("blocks generation if start date is after end date (Excepción E2)", async () => {
    const deps = createMockDeps();
    const controller = createWasteReportController(deps);
    const response = await controller.handle(
      { fechaInicio: "2026-09-20", fechaTermino: "2026-09-10" },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "waste-report",
        message: WASTE_REPORT_DATE_RANGE_ERROR,
      },
    });
    expect(deps.queryWasteReport).not.toHaveBeenCalled();
  });

  it("returns report with items and summary for valid date range (Flujo principal)", async () => {
    const deps = createMockDeps();
    const controller = createWasteReportController(deps);
    const response = await controller.handle(
      { fechaInicio: "2026-09-01", fechaTermino: "2026-09-15" },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: true,
      data: sampleReportData,
    });
    expect(deps.queryWasteReport).toHaveBeenCalledWith({
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-15",
      usuarioId: undefined,
    });
  });

  it("returns empty items array and zero totals when no waste exists (Excepción E1)", async () => {
    const emptyReport: WasteReportData = {
      fechaInicio: "2026-08-01",
      fechaTermino: "2026-08-15",
      items: [],
      resumen: {
        unidadesPorMotivo: {
          vencimiento: 0,
          dano: 0,
          robo: 0,
          error_registro: 0,
        },
        totalUnidades: 0,
        costoTotal: 0,
      },
    };

    const deps = createMockDeps({
      queryWasteReport: vi.fn(async () => emptyReport),
    });
    const controller = createWasteReportController(deps);
    const response = await controller.handle(
      { fechaInicio: "2026-08-01", fechaTermino: "2026-08-15" },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: true,
      data: emptyReport,
    });
  });

  describe("CU49 exportacion (C61 al exportar)", () => {
    it("exports mermas report to PDF and logs audit", async () => {
      const loadWasteReport = vi.fn(async () => sampleReportData);
      const showSaveDialog = vi.fn(async () => ({
        canceled: false,
        filePath: "C:/docs/mermas.pdf",
      }));
      const createWastePdf = vi.fn(async () => Buffer.from("pdf-data"));
      const save = vi.fn(async () => undefined);
      const audit = vi.fn(async () => undefined);

      const controller = createRestockReportExportController({
        load: vi.fn(),
        showSaveDialog,
        createPdf: vi.fn(),
        createXlsx: vi.fn(),
        save,
        now: () => new Date("2026-09-29T12:00:00Z"),
        documentsPath: () => "C:/docs",
        loadWasteReport,
        createWastePdf,
        audit,
      });

      const response = await controller.handle(
        {
          tipoReporte: "mermas",
          fechaInicio: "2026-09-01",
          fechaTermino: "2026-09-15",
        },
        createContext("dueno", "reporte:exportar-pdf"),
      );

      expect(response).toEqual({
        ok: true,
        data: expect.objectContaining({
          formato: "pdf",
          estado: "saved",
          ruta: "C:/docs/mermas.pdf",
          cantidadFilas: 2,
        }),
      });

      expect(loadWasteReport).toHaveBeenCalledWith({
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-15",
        usuarioId: undefined,
      });
      expect(createWastePdf).toHaveBeenCalled();
      expect(save).toHaveBeenCalledWith("C:/docs/mermas.pdf", expect.any(Buffer));
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          modulo: "reportes",
          tipoAccion: "exportar_reporte_mermas",
        }),
      );
    });

    it("exports mermas report to XLSX", async () => {
      const loadWasteReport = vi.fn(async () => sampleReportData);
      const showSaveDialog = vi.fn(async () => ({
        canceled: false,
        filePath: "C:/docs/mermas.xlsx",
      }));
      const createWasteXlsx = vi.fn(async () => Buffer.from("xlsx-data"));
      const save = vi.fn(async () => undefined);
      const audit = vi.fn(async () => undefined);

      const controller = createRestockReportExportController({
        load: vi.fn(),
        showSaveDialog,
        createPdf: vi.fn(),
        createXlsx: vi.fn(),
        save,
        now: () => new Date("2026-09-29T12:00:00Z"),
        documentsPath: () => "C:/docs",
        loadWasteReport,
        createWasteXlsx,
        audit,
      });

      const response = await controller.handle(
        {
          tipoReporte: "mermas",
          fechaInicio: "2026-09-01",
          fechaTermino: "2026-09-15",
        },
        createContext("dueno", "reporte:exportar-xlsx"),
      );

      expect(response).toEqual({
        ok: true,
        data: expect.objectContaining({
          formato: "xlsx",
          estado: "saved",
          ruta: "C:/docs/mermas.xlsx",
          cantidadFilas: 2,
        }),
      });

      expect(createWasteXlsx).toHaveBeenCalled();
      expect(save).toHaveBeenCalled();
      expect(audit).toHaveBeenCalled();
    });

    it("returns BUSINESS_RULE when attempting to export an empty report", async () => {
      const loadWasteReport = vi.fn(async () => ({
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-15",
        items: [],
        resumen: {
          unidadesPorMotivo: {
            vencimiento: 0,
            dano: 0,
            robo: 0,
            error_registro: 0,
          },
          totalUnidades: 0,
          costoTotal: 0,
        },
      }));

      const controller = createRestockReportExportController({
        load: vi.fn(),
        showSaveDialog: vi.fn(),
        createPdf: vi.fn(),
        createXlsx: vi.fn(),
        save: vi.fn(),
        now: () => new Date(),
        documentsPath: () => "C:/docs",
        loadWasteReport,
      });

      const response = await controller.handle(
        {
          tipoReporte: "mermas",
          fechaInicio: "2026-09-01",
          fechaTermino: "2026-09-15",
        },
        createContext("dueno", "reporte:exportar-pdf"),
      );

      expect(response).toEqual({
        ok: false,
        error: {
          code: "BUSINESS_RULE",
          controllerId: "restock-report-export",
          message: "No se encontraron mermas para el período indicado.",
        },
      });
    });
  });
});
