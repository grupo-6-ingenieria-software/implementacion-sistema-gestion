import { describe, expect, it, vi } from "vitest";
import {
  createExpiringLotsReportController,
  type ExpiringLotsReportDependencies,
} from "../../../src/main/controllers/expiring-lots-report";
import { createRestockReportExportController } from "../../../src/main/controllers/restock-report-export";
import type { ControllerContext } from "../../../src/main/controllers/base";
import type {
  ExpiringLotsReportData,
  ExpiringLotsReportRequest,
} from "../../../src/shared/report-expiring-lots";
import {
  EXPIRING_LOTS_EMPTY_MESSAGE,
  EXPIRING_LOTS_HORIZON_ERROR,
} from "../../../src/shared/report-expiring-lots";

const sampleReportData: ExpiringLotsReportData = {
  horizonte: 7,
  categoriaId: null,
  fechaConsulta: "2026-09-30",
  categorias: [
    { id: 1, nombre: "Lácteos" },
    { id: 2, nombre: "Panadería" },
  ],
  items: [
    {
      loteId: "lote-uuid-1",
      productoId: 101,
      productoNombre: "Yogurt Natural 1L",
      productoEan13: "7801234567890",
      categoriaId: 1,
      categoriaNombre: "Lácteos",
      proveedorId: 10,
      proveedorNombre: "Lácteos del Sur S.A.",
      cantidad: 15,
      fechaVencimiento: "2026-10-02",
      diasRestantes: 2,
      precioCosto: 950,
      costoEnRiesgo: 14250,
    },
    {
      loteId: "lote-uuid-2",
      productoId: 102,
      productoNombre: "Queso Gauda 500g",
      productoEan13: "7801234567891",
      categoriaId: 1,
      categoriaNombre: "Lácteos",
      proveedorId: 10,
      proveedorNombre: "Lácteos del Sur S.A.",
      cantidad: 8,
      fechaVencimiento: "2026-10-05",
      diasRestantes: 5,
      precioCosto: 3200,
      costoEnRiesgo: 25600,
    },
  ],
  resumen: {
    totalLotes: 2,
    totalUnidades: 23,
    costoTotalEnRiesgo: 39850,
    porCategoria: [
      {
        categoriaId: 1,
        categoriaNombre: "Lácteos",
        totalLotes: 2,
        totalUnidades: 23,
        costoEnRiesgo: 39850,
      },
    ],
  },
};

function createMockDeps(
  overrides: Partial<ExpiringLotsReportDependencies> = {},
): ExpiringLotsReportDependencies {
  return {
    queryExpiringLotsReport: vi.fn(
      async (_req: ExpiringLotsReportRequest) => sampleReportData,
    ),
    ...overrides,
  };
}

function createContext(
  role: "dueno" | "trabajador" = "dueno",
  channel = "reporte:lotes-por-vencer",
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

describe("C57 ReporteLotesVencerHandler", () => {
  it("registers metadata and handles channel reporte:lotes-por-vencer", () => {
    const controller = createExpiringLotsReportController(createMockDeps());
    expect(controller.metadata.id).toBe("expiring-lots-report");
    expect(controller.metadata.channels).toContain("reporte:lotes-por-vencer");
    expect(controller.metadata.module).toBe("reportes");
  });

  it("denies access when session role is not dueno", async () => {
    const controller = createExpiringLotsReportController(createMockDeps());
    const response = await controller.handle(
      { horizonte: 7 },
      createContext("trabajador"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "expiring-lots-report",
        message: "Operación restringida al rol Dueño.",
      },
    });
  });

  it("executes the main flow and queries expiring lots with default horizon 7", async () => {
    const deps = createMockDeps();
    const controller = createExpiringLotsReportController(deps);

    const response = await controller.handle({}, createContext("dueno"));

    expect(response).toEqual({
      ok: true,
      data: sampleReportData,
    });
    expect(deps.queryExpiringLotsReport).toHaveBeenCalledWith({
      horizonte: 7,
      categoriaId: undefined,
    });
  });

  it("queries with custom horizon and category filter", async () => {
    const deps = createMockDeps();
    const controller = createExpiringLotsReportController(deps);

    const response = await controller.handle(
      { horizonte: 14, categoriaId: 1 },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: true,
      data: sampleReportData,
    });
    expect(deps.queryExpiringLotsReport).toHaveBeenCalledWith({
      horizonte: 14,
      categoriaId: 1,
    });
  });

  it("rejects invalid horizon values with E1 validation error message", async () => {
    const controller = createExpiringLotsReportController(createMockDeps());

    const invalidCases = [0, 32, -5, 100, "abc"];

    for (const invalidHorizon of invalidCases) {
      const response = await controller.handle(
        { horizonte: invalidHorizon },
        createContext("dueno"),
      );

      expect(response).toEqual({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          controllerId: "expiring-lots-report",
          message: EXPIRING_LOTS_HORIZON_ERROR,
        },
      });
    }
  });

  it("handles empty results correctly (E1 empty state)", async () => {
    const emptyData: ExpiringLotsReportData = {
      horizonte: 7,
      categoriaId: null,
      fechaConsulta: "2026-09-30",
      categorias: [],
      items: [],
      resumen: {
        totalLotes: 0,
        totalUnidades: 0,
        costoTotalEnRiesgo: 0,
        porCategoria: [],
      },
    };

    const deps = createMockDeps({
      queryExpiringLotsReport: vi.fn(async () => emptyData),
    });
    const controller = createExpiringLotsReportController(deps);

    const response = await controller.handle(
      { horizonte: 7 },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: true,
      data: emptyData,
    });
  });
});

describe("C61 Expiring Lots Report Export Integration", () => {
  it("exports PDF with expiring lots data and audits operation", async () => {
    const mockAudit = vi.fn(async () => undefined);
    const mockSave = vi.fn(async () => undefined);
    const mockCreatePdf = vi.fn(async () => Buffer.from("fake-pdf"));

    const exportController = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: "/fake/path/LotesPorVencer_Horizonte7d_30-09-2026.pdf",
      })),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: mockSave,
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/documents",
      loadExpiringLotsReport: vi.fn(async () => sampleReportData),
      createExpiringLotsPdf: mockCreatePdf,
      audit: mockAudit,
    });

    const response = await exportController.handle(
      {
        tipoReporte: "lotes-por-vencer",
        horizonte: 7,
      },
      createContext("dueno", "reporte:exportar-pdf"),
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        formato: "pdf",
        estado: "saved",
        cantidadFilas: 2,
      },
    });
    expect(mockCreatePdf).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAccion: "exportar_reporte_lotes_por_vencer",
        modulo: "reportes",
      }),
    );
  });

  it("exports XLSX with expiring lots data", async () => {
    const mockSave = vi.fn(async () => undefined);
    const mockCreateXlsx = vi.fn(async () => Buffer.from("fake-xlsx"));

    const exportController = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: "/fake/path/LotesPorVencer_Horizonte7d_30-09-2026.xlsx",
      })),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: mockSave,
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/documents",
      loadExpiringLotsReport: vi.fn(async () => sampleReportData),
      createExpiringLotsXlsx: mockCreateXlsx,
      audit: vi.fn(async () => undefined),
    });

    const response = await exportController.handle(
      {
        tipoReporte: "lotes-por-vencer",
        horizonte: 7,
      },
      createContext("dueno", "reporte:exportar-xlsx"),
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        formato: "xlsx",
        estado: "saved",
      },
    });
    expect(mockCreateXlsx).toHaveBeenCalled();
  });

  it("rejects export when report has 0 items with empty message", async () => {
    const exportController = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: vi.fn(),
      now: () => new Date(),
      documentsPath: () => "/fake/documents",
      loadExpiringLotsReport: vi.fn(async () => ({
        ...sampleReportData,
        items: [],
        resumen: {
          totalLotes: 0,
          totalUnidades: 0,
          costoTotalEnRiesgo: 0,
          porCategoria: [],
        },
      })),
    });

    const response = await exportController.handle(
      {
        tipoReporte: "lotes-por-vencer",
        horizonte: 7,
      },
      createContext("dueno", "reporte:exportar-pdf"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        controllerId: "restock-report-export",
        message: EXPIRING_LOTS_EMPTY_MESSAGE,
      },
    });
  });
});
