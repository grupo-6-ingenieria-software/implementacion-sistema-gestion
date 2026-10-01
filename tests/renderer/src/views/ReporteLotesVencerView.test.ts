import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import {
  exportExpiringLotsReport,
  fetchExpiringLotsReport,
  formatCurrency,
  formatNumber,
  ReporteLotesVencerView,
} from "../../../../src/renderer/src/views/ReporteLotesVencerView";
import { ReporteLotesVencerPrintView } from "../../../../src/renderer/src/components/ReporteLotesVencerPrintView";
import type { ControllerResponse } from "../../../../src/shared/controllers";
import type { ExpiringLotsReportData } from "../../../../src/shared/report-expiring-lots";
import { EXPIRING_LOTS_EMPTY_MESSAGE } from "../../../../src/shared/report-expiring-lots";

const sampleReport: ExpiringLotsReportData = {
  horizonte: 7,
  categoriaId: null,
  fechaConsulta: "2026-09-30",
  categorias: [
    { id: 1, nombre: "Lácteos" },
    { id: 2, nombre: "Bebidas" },
  ],
  items: [
    {
      loteId: "lote-uuid-1",
      productoId: 101,
      productoNombre: "Leche Semidescremada 1L",
      productoEan13: "7802920000015",
      categoriaId: 1,
      categoriaNombre: "Lácteos",
      proveedorId: 5,
      proveedorNombre: "Colun",
      cantidad: 12,
      fechaVencimiento: "2026-10-02",
      diasRestantes: 2,
      precioCosto: 850,
      costoEnRiesgo: 10200,
    },
    {
      loteId: "lote-uuid-2",
      productoId: 102,
      productoNombre: "Jugo Naranja 1L",
      productoEan13: "7802920000022",
      categoriaId: 2,
      categoriaNombre: "Bebidas",
      proveedorId: 6,
      proveedorNombre: "Andina",
      cantidad: 20,
      fechaVencimiento: "2026-10-06",
      diasRestantes: 6,
      precioCosto: 1100,
      costoEnRiesgo: 22000,
    },
  ],
  resumen: {
    totalLotes: 2,
    totalUnidades: 32,
    costoTotalEnRiesgo: 32200,
    porCategoria: [
      {
        categoriaId: 2,
        categoriaNombre: "Bebidas",
        totalLotes: 1,
        totalUnidades: 20,
        costoEnRiesgo: 22000,
      },
      {
        categoriaId: 1,
        categoriaNombre: "Lácteos",
        totalLotes: 1,
        totalUnidades: 12,
        costoEnRiesgo: 10200,
      },
    ],
  },
};

describe("CU50 ReporteLotesVencerView renderer", () => {
  it("registers reporte-lotes-vencer in isImplementedViewNodeId", () => {
    expect(isImplementedViewNodeId("reporte-lotes-vencer")).toBe(true);
  });

  it("invokes reporte:lotes-por-vencer and handles data and errors", async () => {
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<ExpiringLotsReportData>> => ({
        ok: true,
        data: sampleReport,
      }),
    );

    const result = await fetchExpiringLotsReport(
      invoke as typeof window.appApi.invoke,
      {
        horizonte: 7,
        categoriaId: undefined,
      },
    );

    expect(result).toEqual(sampleReport);
    expect(invoke).toHaveBeenCalledWith("reporte:lotes-por-vencer", {
      horizonte: 7,
      categoriaId: undefined,
    });

    const failingInvoke = vi.fn(
      async (): Promise<ControllerResponse<ExpiringLotsReportData>> => ({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Ingrese un valor entre 1 y 31 días",
        },
      }),
    );

    await expect(
      fetchExpiringLotsReport(failingInvoke as typeof window.appApi.invoke, {
        horizonte: 40,
      }),
    ).rejects.toThrow("Ingrese un valor entre 1 y 31 días");
  });

  it("invokes export channels for PDF and XLSX", async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      data: {
        formato: "pdf",
        estado: "saved",
        ruta: "/docs/LotesPorVencer_Horizonte7d_30-09-2026.pdf",
        cantidadFilas: 2,
        fechaGeneracion: "2026-09-30T12:00:00Z",
      },
    }));

    const resultPdf = await exportExpiringLotsReport(
      invoke as typeof window.appApi.invoke,
      {
        tipoReporte: "lotes-por-vencer",
        horizonte: 7,
      },
      "pdf",
    );

    expect(resultPdf.estado).toBe("saved");
    expect(invoke).toHaveBeenCalledWith("reporte:exportar-pdf", {
      tipoReporte: "lotes-por-vencer",
      horizonte: 7,
    });

    await exportExpiringLotsReport(
      invoke as typeof window.appApi.invoke,
      {
        tipoReporte: "lotes-por-vencer",
        horizonte: 7,
      },
      "xlsx",
    );

    expect(invoke).toHaveBeenCalledWith("reporte:exportar-xlsx", {
      tipoReporte: "lotes-por-vencer",
      horizonte: 7,
    });
  });

  it("formats Chilean currency and numbers accurately", () => {
    expect(formatCurrency(32200)).toMatch(/\$32\.200/);
    expect(formatNumber(1500)).toMatch(/1\.500/);
  });

  it("renders ReporteLotesVencerPrintView markup with required columns and summary", () => {
    const markup = renderToStaticMarkup(
      createElement(ReporteLotesVencerPrintView, {
        horizonte: 7,
        fechaGeneracion: "30-09-2026 12:00",
        items: sampleReport.items,
        resumen: sampleReport.resumen,
        usuario: "Juan Dueño",
      }),
    );

    expect(markup).toContain("Minimarket y Panadería Huáscar");
    expect(markup).toContain("Reporte de lotes próximos a vencer");
    expect(markup).toContain("Leche Semidescremada 1L");
    expect(markup).toContain("Jugo Naranja 1L");
    expect(markup).toContain("Colun");
    expect(markup).toContain("Andina");
    expect(markup).toContain("7 días");
    expect(markup).toContain("Total lotes por vencer");
  });

  it("renders ReporteLotesVencerView initial component structure", () => {
    const markup = renderToStaticMarkup(
      createElement(ReporteLotesVencerView, {
        usuarioId: "user-1",
      }),
    );

    expect(markup).toContain("Reporte de Lotes Próximos a Vencer");
    expect(markup).toContain("Horizonte de días (1 a 31)");
    expect(markup).toContain("Categoría");
    expect(markup).toContain("Consultar");
    expect(markup).toContain("Exportar PDF");
    expect(markup).toContain("Exportar Excel");
  });
});
