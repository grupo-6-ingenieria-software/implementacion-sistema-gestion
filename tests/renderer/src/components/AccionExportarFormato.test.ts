import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AccionExportarFormato,
  exportInventoryList,
  inventoryExportNotice,
  exportGeneratedReport,
  verifyGeneratedReport,
  ReportActionError,
} from "../../../../src/renderer/src/components/AccionExportarFormato";
import { ProductListView } from "../../../../src/renderer/src/views/ProductListView";
import {
  INVENTORY_AUDIT_WARNING,
  INVENTORY_EXPORT_ERROR_MESSAGE,
  type InventoryExportResult,
} from "../../../../src/shared/inventory-export";
import type { ControllerResponse } from "../../../../src/shared/controllers";

const base = {
  formato: "pdf" as const,
  cantidadFilas: 2,
  fechaGeneracion: "2026-09-12T23:30:00Z",
};
describe("CU20 UI06 helpers and V06 integration", () => {
  it.each(["dueno", "trabajador"] as const)(
    "exposes export even before a visible catalog exists for %s",
    (role) => {
      const html = renderToStaticMarkup(
        createElement(ProductListView, {
          role,
          usuarioId: "user",
          onNavigate: vi.fn(),
        }),
      );
      expect(html).toContain("Exportar listado");
      expect(html).not.toContain("Formato de exportación");
    },
  );
  it("renders an accessible internal action without a separate route", () => {
    const html = renderToStaticMarkup(createElement(AccionExportarFormato));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-busy="false"');
  });
  it.each(["pdf", "xlsx"] as const)(
    "sends only format %s through IPC",
    async (formato) => {
      const result: InventoryExportResult = {
        ...base,
        formato,
        estado: "cancelled",
      };
      const invoke = vi.fn(
        async (): Promise<ControllerResponse<unknown>> => ({
          ok: true,
          data: result,
        }),
      );
      expect(
        await exportInventoryList(
          invoke as typeof window.appApi.invoke,
          formato,
        ),
      ).toEqual(result);
      expect(invoke).toHaveBeenCalledWith("inventario:exportar-productos", {
        formato,
      });
    },
  );
  it("preserves backend messages and normalizes transport failure to E2", async () => {
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({
        ok: false,
        error: {
          code: "BUSINESS_RULE",
          message: "No hay productos para exportar",
        },
      }),
    );
    await expect(
      exportInventoryList(invoke as typeof window.appApi.invoke, "pdf"),
    ).rejects.toThrow("No hay productos para exportar");
    invoke.mockRejectedValueOnce(new Error("IPC details"));
    await expect(
      exportInventoryList(invoke as typeof window.appApi.invoke, "pdf"),
    ).rejects.toThrow(INVENTORY_EXPORT_ERROR_MESSAGE);
  });
  it("distinguishes cancellation, saved and saved-with-warning notices", () => {
    expect(inventoryExportNotice({ ...base, estado: "cancelled" }).tone).toBe(
      "neutral",
    );
    expect(
      inventoryExportNotice({
        ...base,
        estado: "saved",
        ruta: "list.pdf",
        auditoria: "registrada",
      }),
    ).toEqual({ tone: "success", message: "Archivo guardado en list.pdf." });
    expect(
      inventoryExportNotice({
        ...base,
        estado: "saved",
        ruta: "list.pdf",
        auditoria: "fallida",
        advertencia: INVENTORY_AUDIT_WARNING,
      }),
    ).toEqual({
      tone: "warning",
      message: `Archivo guardado en list.pdf. ${INVENTORY_AUDIT_WARNING}`,
    });
  });
});

describe("CU54 UI06 report mode", () => {
  const request = { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 } };
  it("uses the common internal action and supports disabling before data is available", () => {
    const html = renderToStaticMarkup(createElement(AccionExportarFormato, { mode: "report", request, disabled: true }));
    expect(html).toContain("Exportar reporte"); expect(html).toContain("disabled");
    expect(html).not.toContain("Exportar listado");
  });
  it.each(["pdf", "xlsx"] as const)("sends only the generated descriptor for %s", async (format) => {
    const invoke = vi.fn(async () => ({ ok: true as const, data: { ...base, formato: format, estado: "saved" } }));
    await exportGeneratedReport(invoke as typeof window.appApi.invoke, format, { ...request, filas: [], ruta: "fake" } as typeof request);
    expect(invoke).toHaveBeenCalledWith(`reporte:exportar-${format}`, request);
  });
  it("preserves uncertain operation IDs and forbidden responses for the interface", async () => {
    const id = "00000000-0000-4000-8000-000000000054";
    const invoke = vi.fn(async () => ({ ok: false as const, error: { code: "EXPORT_RECONCILIATION_REQUIRED" as const, message: "No fue posible generar el archivo", operacionId: id } }));
    await expect(exportGeneratedReport(invoke as typeof window.appApi.invoke, "pdf", request)).rejects.toMatchObject({ code: "EXPORT_RECONCILIATION_REQUIRED", operacionId: id });
    const verify = vi.fn(async () => ({ ok: true as const, data: { estado: "pending", operacionId: id } }));
    expect(await verifyGeneratedReport(verify as typeof window.appApi.invoke, id)).toEqual({ estado: "pending", operacionId: id });
    expect(verify).toHaveBeenCalledWith("reporte:conciliar-exportacion", { operacionId: id });
    expect(new ReportActionError("denied", "FORBIDDEN").code).toBe("FORBIDDEN");
  });
});
