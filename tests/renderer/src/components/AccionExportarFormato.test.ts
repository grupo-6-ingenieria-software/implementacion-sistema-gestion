import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AccionExportarFormato,
  exportInventoryList,
  inventoryExportNotice,
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
  it.each([
    { disabled: false, exporting: false, label: "Exportar" },
    { disabled: true, exporting: false, label: "Exportar" },
    { disabled: false, exporting: true, label: "Exportando..." },
  ])("preserves the daily report export controls for $label (disabled: $disabled)", ({ disabled, exporting, label }) => {
    const html = renderToStaticMarkup(createElement(AccionExportarFormato, {
      format: "xlsx",
      disabled,
      exporting,
      onFormatChange: vi.fn(),
      onExport: vi.fn(),
    }));
    expect(html).toContain('aria-label="Formato de exportación"');
    expect(html).toContain('<option value="xlsx" selected="">');
    expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain("Exportar listado");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(disabled || exporting ? 2 : 0);
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
