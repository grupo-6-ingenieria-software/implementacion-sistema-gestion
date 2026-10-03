import { describe, expect, it, vi } from "vitest";
import {
  createMovementReportController,
  type MovementReportDependencies,
} from "../../../src/main/controllers/movement-report";
import { createRestockReportExportController } from "../../../src/main/controllers/restock-report-export";
import type { ControllerContext } from "../../../src/main/controllers/base";
import type {
  MovementReportData,
  MovementReportRequest,
} from "../../../src/shared/report-movements";
import {
  MOVEMENT_REPORT_DATE_RANGE_ERROR,
  MOVEMENT_REPORT_EMPTY_MESSAGE,
  MOVEMENT_REPORT_INVALID_DATE_ERROR,
} from "../../../src/shared/report-movements";

const sampleMovementData: MovementReportData = {
  fechaInicio: "2026-09-01",
  fechaTermino: "2026-09-30",
  tipo: null,
  categoriaId: null,
  usuarioId: null,
  categorias: [
    { id: 1, nombre: "Bebidas" },
    { id: 2, nombre: "Lácteos" },
  ],
  usuarios: [
    { id: "usr-1", nombre: "Tomás Dueño" },
    { id: "usr-2", nombre: "Cajero Juan" },
  ],
  tipos: [
    { id: "ingreso_lote", label: "Ingreso de lote" },
    { id: "venta", label: "Venta" },
    { id: "restitucion", label: "Restitución" },
    { id: "merma", label: "Merma" },
    { id: "ajuste_manual", label: "Ajuste manual" },
  ],
  items: [
    {
      id: "evt-1",
      fechaHora: "2026-09-20 14:30:00",
      tipo: "venta",
      tipoLabel: "Venta",
      productoId: 10,
      productoNombre: "Bebida Cola 1.5L",
      productoEan13: "7801234567890",
      categoriaId: 1,
      categoriaNombre: "Bebidas",
      cantidad: -2,
      saldo: 18,
      loteId: "lote-1",
      descripcion: "Venta V-100",
      usuarioId: "usr-2",
      usuarioNombre: "Cajero Juan",
    },
    {
      id: "evt-2",
      fechaHora: "2026-09-05 10:00:00",
      tipo: "ingreso_lote",
      tipoLabel: "Ingreso de lote",
      productoId: 10,
      productoNombre: "Bebida Cola 1.5L",
      productoEan13: "7801234567890",
      categoriaId: 1,
      categoriaNombre: "Bebidas",
      cantidad: 20,
      saldo: 20,
      loteId: "lote-1",
      descripcion: "Ingreso de lote",
      usuarioId: "usr-1",
      usuarioNombre: "Tomás Dueño",
    },
  ],
  resumen: {
    totalMovimientos: 2,
    totalEntradas: 20,
    totalSalidas: 2,
    resumenPorTipo: [
      {
        tipo: "ingreso_lote",
        tipoLabel: "Ingreso de lote",
        totalMovimientos: 1,
        totalUnidades: 20,
      },
      {
        tipo: "venta",
        tipoLabel: "Venta",
        totalMovimientos: 1,
        totalUnidades: 2,
      },
      {
        tipo: "restitucion",
        tipoLabel: "Restitución",
        totalMovimientos: 0,
        totalUnidades: 0,
      },
      {
        tipo: "merma",
        tipoLabel: "Merma",
        totalMovimientos: 0,
        totalUnidades: 0,
      },
      {
        tipo: "ajuste_manual",
        tipoLabel: "Ajuste manual",
        totalMovimientos: 0,
        totalUnidades: 0,
      },
    ],
  },
};

function createMockDeps(
  overrides: Partial<MovementReportDependencies> = {},
): MovementReportDependencies {
  return {
    queryMovementReport: vi.fn(
      async (_req: MovementReportRequest) => sampleMovementData,
    ),
    ...overrides,
  };
}

function createContext(
  role: "dueno" | "trabajador" = "dueno",
  channel = "reporte:movimientos-inventario",
): ControllerContext {
  return {
    channel,
    claims: {
      usuarioId: "usr-1",
      rol: role,
      usuarioRol: role,
      passwordTemporal: false,
      sesionId: "sesion-1",
    },
  };
}

describe("C60 ReporteMovimientosHandler", () => {
  it("registers metadata and handles channel reporte:movimientos-inventario", () => {
    const controller = createMovementReportController(createMockDeps());
    expect(controller.metadata.id).toBe("movement-report");
    expect(controller.metadata.channels).toContain("reporte:movimientos-inventario");
    expect(controller.metadata.module).toBe("reportes");
  });

  it("denies access when session role is not dueno", async () => {
    const controller = createMovementReportController(createMockDeps());
    const response = await controller.handle(
      { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" },
      createContext("trabajador"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "movement-report",
        message: "Operación restringida al rol Dueño.",
      },
    });
  });

  it("returns validation error (E2) when start date is after end date", async () => {
    const controller = createMovementReportController(createMockDeps());
    const response = await controller.handle(
      { fechaInicio: "2026-09-30", fechaTermino: "2026-09-01" },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "movement-report",
        message: MOVEMENT_REPORT_DATE_RANGE_ERROR,
      },
    });
  });

  it("returns validation error when dates are invalid or malformed", async () => {
    const controller = createMovementReportController(createMockDeps());
    const response = await controller.handle(
      { fechaInicio: "fecha-invalida", fechaTermino: "2026-09-30" },
      createContext("dueno"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "movement-report",
        message: MOVEMENT_REPORT_INVALID_DATE_ERROR,
      },
    });
  });

  it("executes query and returns movement report data with filters", async () => {
    const mockQuery = vi.fn(async () => sampleMovementData);
    const controller = createMovementReportController({
      queryMovementReport: mockQuery,
    });

    const response = await controller.handle(
      {
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
        tipo: "venta",
        categoriaId: 1,
        usuarioFiltroId: "usr-2",
      },
      createContext("dueno"),
    );

    expect(mockQuery).toHaveBeenCalledWith({
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-30",
      tipo: "venta",
      categoriaId: 1,
      usuarioFiltroId: "usr-2",
    });

    expect(response).toEqual({
      ok: true,
      data: sampleMovementData,
    });
  });
});

describe("C61 ExportacionReportesHandler - Movimientos de Inventario", () => {
  it("denies export when user is not dueno", async () => {
    const controller = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: vi.fn(),
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/docs",
    });

    const response = await controller.handle(
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      createContext("trabajador", "reporte:exportar-pdf"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        controllerId: "restock-report-export",
        message: "Operación restringida al rol Dueño.",
      },
    });
  });

  it("validates date range before exporting", async () => {
    const controller = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: vi.fn(),
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/docs",
    });

    const response = await controller.handle(
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-30",
        fechaTermino: "2026-09-01",
      },
      createContext("dueno", "reporte:exportar-xlsx"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "restock-report-export",
        message: MOVEMENT_REPORT_DATE_RANGE_ERROR,
      },
    });
  });

  it("blocks export if report has no items (E1)", async () => {
    const controller = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: vi.fn(),
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/docs",
      loadMovementReport: vi.fn(async () => ({
        ...sampleMovementData,
        items: [],
      })),
    });

    const response = await controller.handle(
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      createContext("dueno", "reporte:exportar-xlsx"),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "BUSINESS_RULE",
        controllerId: "restock-report-export",
        message: MOVEMENT_REPORT_EMPTY_MESSAGE,
      },
    });
  });

  it("exports Excel successfully and logs audit", async () => {
    const saveMock = vi.fn(async () => {});
    const auditMock = vi.fn(async () => {});
    const createXlsxMock = vi.fn(async () => Buffer.from("excel-content"));

    const controller = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: "/fake/docs/MovimientosInventario_2026-09-01_al_2026-09-30_30-09-2026.xlsx",
      })),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: saveMock,
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/docs",
      loadMovementReport: vi.fn(async () => sampleMovementData),
      createMovementXlsx: createXlsxMock,
      audit: auditMock,
    });

    const response = await controller.handle(
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      createContext("dueno", "reporte:exportar-xlsx"),
    );

    expect(createXlsxMock).toHaveBeenCalledOnce();
    expect(saveMock).toHaveBeenCalledWith(
      "/fake/docs/MovimientosInventario_2026-09-01_al_2026-09-30_30-09-2026.xlsx",
      Buffer.from("excel-content"),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modulo: "reportes",
        tipoAccion: "exportar_reporte_movimientos_inventario",
      }),
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        formato: "xlsx",
        estado: "saved",
        cantidadFilas: 2,
      },
    });
  });

  it("exports PDF successfully and logs audit", async () => {
    const saveMock = vi.fn(async () => {});
    const auditMock = vi.fn(async () => {});
    const createPdfMock = vi.fn(async () => Buffer.from("pdf-content"));

    const controller = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: "/fake/docs/MovimientosInventario_2026-09-01_al_2026-09-30_30-09-2026.pdf",
      })),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: saveMock,
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/docs",
      loadMovementReport: vi.fn(async () => sampleMovementData),
      createMovementPdf: createPdfMock,
      audit: auditMock,
    });

    const response = await controller.handle(
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      createContext("dueno", "reporte:exportar-pdf"),
    );

    expect(createPdfMock).toHaveBeenCalledOnce();
    expect(saveMock).toHaveBeenCalledWith(
      "/fake/docs/MovimientosInventario_2026-09-01_al_2026-09-30_30-09-2026.pdf",
      Buffer.from("pdf-content"),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modulo: "reportes",
        tipoAccion: "exportar_reporte_movimientos_inventario",
      }),
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        formato: "pdf",
        estado: "saved",
        cantidadFilas: 2,
      },
    });
  });

  it("returns cancelled state when user cancels save dialog without auditing", async () => {
    const auditMock = vi.fn(async () => {});
    const controller = createRestockReportExportController({
      load: vi.fn(),
      showSaveDialog: vi.fn(async () => ({
        canceled: true,
      })),
      createPdf: vi.fn(),
      createXlsx: vi.fn(),
      save: vi.fn(),
      now: () => new Date("2026-09-30T15:00:00Z"),
      documentsPath: () => "/fake/docs",
      loadMovementReport: vi.fn(async () => sampleMovementData),
      audit: auditMock,
    });

    const response = await controller.handle(
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      createContext("dueno", "reporte:exportar-pdf"),
    );

    expect(auditMock).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: true,
      data: {
        formato: "pdf",
        estado: "cancelled",
        cantidadFilas: 2,
      },
    });
  });
});
