import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import {
  exportMovementReport,
  fetchMovementReport,
  formatNumber,
  ReporteMovimientosView,
} from "../../../../src/renderer/src/views/ReporteMovimientosView";
import { ReporteMovimientosPrintView } from "../../../../src/renderer/src/components/ReporteMovimientosPrintView";
import type { ControllerResponse } from "../../../../src/shared/controllers";
import type { MovementReportData } from "../../../../src/shared/report-movements";
import { MOVEMENT_REPORT_EMPTY_MESSAGE } from "../../../../src/shared/report-movements";

const sampleReport: MovementReportData = {
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
    { id: "usr-2", nombre: "Juan Cajero" },
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
      id: "mov-1",
      fechaHora: "2026-09-15 11:20:00",
      tipo: "ingreso_lote",
      tipoLabel: "Ingreso de lote",
      productoId: 10,
      productoNombre: "Coca-Cola 1.5L",
      productoEan13: "7801610000010",
      categoriaId: 1,
      categoriaNombre: "Bebidas",
      cantidad: 24,
      saldo: 24,
      loteId: "lote-abc-1",
      descripcion: "Ingreso de lote",
      usuarioId: "usr-1",
      usuarioNombre: "Tomás Dueño",
    },
    {
      id: "mov-2",
      fechaHora: "2026-09-16 15:45:00",
      tipo: "venta",
      tipoLabel: "Venta",
      productoId: 10,
      productoNombre: "Coca-Cola 1.5L",
      productoEan13: "7801610000010",
      categoriaId: 1,
      categoriaNombre: "Bebidas",
      cantidad: -3,
      saldo: 21,
      loteId: "lote-abc-1",
      descripcion: "Venta V-101",
      usuarioId: "usr-2",
      usuarioNombre: "Juan Cajero",
    },
  ],
  resumen: {
    totalMovimientos: 2,
    totalEntradas: 24,
    totalSalidas: 3,
    resumenPorTipo: [
      {
        tipo: "ingreso_lote",
        tipoLabel: "Ingreso de lote",
        totalMovimientos: 1,
        totalUnidades: 24,
      },
      {
        tipo: "venta",
        tipoLabel: "Venta",
        totalMovimientos: 1,
        totalUnidades: 3,
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

describe("CU53 ReporteMovimientosView renderer", () => {
  it("registers reporte-movimientos in isImplementedViewNodeId", () => {
    expect(isImplementedViewNodeId("reporte-movimientos")).toBe(true);
  });

  it("invokes reporte:movimientos-inventario and handles data and errors", async () => {
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<MovementReportData>> => ({
        ok: true,
        data: sampleReport,
      }),
    );

    const result = await fetchMovementReport(
      invoke as typeof window.appApi.invoke,
      {
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
        tipo: "venta",
      },
    );

    expect(result).toEqual(sampleReport);
    expect(invoke).toHaveBeenCalledWith("reporte:movimientos-inventario", {
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-30",
      tipo: "venta",
    });

    const failingInvoke = vi.fn(
      async (): Promise<ControllerResponse<MovementReportData>> => ({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "La fecha de inicio no puede ser posterior a la de término.",
        },
      }),
    );

    await expect(
      fetchMovementReport(failingInvoke as typeof window.appApi.invoke, {
        fechaInicio: "2026-09-30",
        fechaTermino: "2026-09-01",
      }),
    ).rejects.toThrow("La fecha de inicio no puede ser posterior a la de término.");
  });

  it("invokes export channels for PDF and XLSX", async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      data: {
        formato: "pdf",
        estado: "saved",
        ruta: "/docs/MovimientosInventario_2026-09-01_al_2026-09-30_30-09-2026.pdf",
        cantidadFilas: 2,
        fechaGeneracion: "2026-09-30T12:00:00Z",
      },
    }));

    const resultPdf = await exportMovementReport(
      invoke as typeof window.appApi.invoke,
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      "pdf",
    );

    expect(resultPdf.estado).toBe("saved");
    expect(invoke).toHaveBeenCalledWith("reporte:exportar-pdf", {
      tipoReporte: "movimientos-inventario",
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-30",
    });

    await exportMovementReport(
      invoke as typeof window.appApi.invoke,
      {
        tipoReporte: "movimientos-inventario",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
      },
      "xlsx",
    );

    expect(invoke).toHaveBeenCalledWith("reporte:exportar-xlsx", {
      tipoReporte: "movimientos-inventario",
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-30",
    });
  });

  it("formats numbers accurately for Chilean locale", () => {
    expect(formatNumber(1500)).toMatch(/1\.500/);
    expect(formatNumber(0)).toBe("0");
  });

  it("renders ReporteMovimientosPrintView markup with required columns and summary", () => {
    const markup = renderToStaticMarkup(
      createElement(ReporteMovimientosPrintView, {
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-30",
        fechaGeneracion: "30-09-2026 12:00",
        items: sampleReport.items,
        resumen: sampleReport.resumen,
        usuario: "Tomás Dueño",
      }),
    );

    expect(markup).toContain("Minimarket y Panadería Huáscar");
    expect(markup).toContain("Reporte de auditoría de movimientos de inventario");
    expect(markup).toContain("Coca-Cola 1.5L");
    expect(markup).toContain("7801610000010");
    expect(markup).toContain("Bebidas");
    expect(markup).toContain("Ingreso de lote");
    expect(markup).toContain("Venta");
    expect(markup).toContain("Total movimientos");
    expect(markup).toContain("Total entradas");
    expect(markup).toContain("Total salidas");
  });

  it("renders ReporteMovimientosView initial component structure", () => {
    const markup = renderToStaticMarkup(
      createElement(ReporteMovimientosView, {
        usuarioId: "user-1",
      }),
    );

    expect(markup).toContain("Auditoría de Movimientos de Inventario");
    expect(markup).toContain("Fecha inicio");
    expect(markup).toContain("Fecha término");
    expect(markup).toContain("Tipo de movimiento");
    expect(markup).toContain("Categoría");
    expect(markup).toContain("Usuario");
    expect(markup).toContain("Consultar");
    expect(markup).toContain("Exportar PDF");
    expect(markup).toContain("Exportar Excel");
  });
});
