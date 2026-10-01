import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import {
  exportWasteReport,
  fetchWasteReport,
  formatCurrency,
  formatNumber,
  ReporteMermasView,
} from "../../../../src/renderer/src/views/ReporteMermasView";
import { ReporteMermasPrintView } from "../../../../src/renderer/src/components/ReporteMermasPrintView";
import type { ControllerResponse } from "../../../../src/shared/controllers";
import type { WasteReportData } from "../../../../src/shared/report-waste";
import { WASTE_REPORT_EMPTY_MESSAGE } from "../../../../src/shared/report-waste";

const sampleReport: WasteReportData = {
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
      fechaHora: "2026-09-12 11:30:00",
      productoNombre: "Pan de Molde 500g",
      productoEan13: "7802920000039",
      categoriaNombre: "Panadería",
      cantidad: 5,
      motivo: "dano",
      usuarioNombre: "María González",
      loteId: "lote-2",
      costoUnitario: 1200,
      costoTotal: 6000,
    },
  ],
  resumen: {
    unidadesPorMotivo: {
      vencimiento: 3,
      dano: 5,
      robo: 0,
      error_registro: 0,
    },
    totalUnidades: 8,
    costoTotal: 8400,
  },
};

describe("CU49 ReporteMermasView renderer", () => {
  it("registers reporte-mermas in isImplementedViewNodeId", () => {
    expect(isImplementedViewNodeId("reporte-mermas")).toBe(true);
  });

  it("invokes reporte:mermas and handles data and errors", async () => {
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<WasteReportData>> => ({
        ok: true,
        data: sampleReport,
      }),
    );

    const result = await fetchWasteReport(
      invoke as typeof window.appApi.invoke,
      {
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-15",
        usuarioId: "user-1",
      },
    );

    expect(result).toEqual(sampleReport);
    expect(invoke).toHaveBeenCalledWith("reporte:mermas", {
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-15",
      usuarioId: "user-1",
    });

    const failingInvoke = vi.fn(
      async (): Promise<ControllerResponse<WasteReportData>> => ({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Error de rango" },
      }),
    );

    await expect(
      fetchWasteReport(failingInvoke as typeof window.appApi.invoke, {
        fechaInicio: "2026-09-20",
        fechaTermino: "2026-09-10",
      }),
    ).rejects.toThrow("Error de rango");
  });

  it("invokes export channels for PDF and XLSX", async () => {
    const invoke = vi.fn(async (): Promise<ControllerResponse<unknown>> => ({
      ok: true,
      data: {
        formato: "pdf",
        estado: "saved",
        ruta: "C:/docs/mermas.pdf",
        cantidadFilas: 2,
        fechaGeneracion: "2026-09-29T12:00:00Z",
      },
    }));

    await exportWasteReport(
      invoke as typeof window.appApi.invoke,
      {
        tipoReporte: "mermas",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-15",
        usuarioId: "user-1",
      },
      "pdf",
    );

    expect(invoke).toHaveBeenCalledWith("reporte:exportar-pdf", {
      tipoReporte: "mermas",
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-15",
      usuarioId: "user-1",
    });

    await exportWasteReport(
      invoke as typeof window.appApi.invoke,
      {
        tipoReporte: "mermas",
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-15",
        usuarioId: "user-1",
      },
      "xlsx",
    );

    expect(invoke).toHaveBeenCalledWith("reporte:exportar-xlsx", {
      tipoReporte: "mermas",
      fechaInicio: "2026-09-01",
      fechaTermino: "2026-09-15",
      usuarioId: "user-1",
    });
  });

  it("formats Chilean currency and numbers correctly", () => {
    expect(formatCurrency(8400)).toContain("8.400");
    expect(formatNumber(1250)).toContain("1.250");
  });

  it("renders ReporteMermasPrintView with metadata, summary and items", () => {
    const markup = renderToStaticMarkup(
      createElement(ReporteMermasPrintView, {
        fechaInicio: "2026-09-01",
        fechaTermino: "2026-09-15",
        fechaGeneracion: "15-09-2026 18:00",
        items: sampleReport.items,
        resumen: sampleReport.resumen,
        usuario: "Juan Pérez",
      }),
    );

    expect(markup).toContain("Minimarket y Panadería Huáscar");
    expect(markup).toContain("Reporte de mermas");
    expect(markup).toContain("2026-09-01 al 2026-09-15");
    expect(markup).toContain("Leche Entera 1L");
    expect(markup).toContain("Pan de Molde 500g");
    expect(markup).toContain("Vencimiento");
    expect(markup).toContain("Daño");
  });

  it("renders initial ReporteMermasView markup", () => {
    // Mock window.appApi before rendering
    (globalThis as unknown as { window: { appApi: { invoke: unknown } } }).window = {
      appApi: {
        invoke: vi.fn(async () => ({ ok: true, data: sampleReport })),
      },
    };

    const markup = renderToStaticMarkup(
      createElement(ReporteMermasView, { usuarioId: "user-1" }),
    );

    expect(markup).toContain("Reporte de mermas");
    expect(markup).toContain("Fecha inicio");
    expect(markup).toContain("Fecha término");
    expect(markup).toContain("Generar reporte");
    expect(markup).toContain("Exportar PDF");
    expect(markup).toContain("Exportar XLSX");
  });
});
