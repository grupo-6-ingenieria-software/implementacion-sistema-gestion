import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import {
  InventoryValuationContent,
  formatInventoryCount,
  formatInventoryCurrency,
  loadInventoryValuation,
} from "../../../../src/renderer/src/views/ValorizacionInventarioView";
import type { ControllerResponse } from "../../../../src/shared/controllers";

describe("CU19 inventory valuation renderer", () => {
  it("loads C36 with the session identity and propagates errors", async () => {
    const data = {
      categorias: [],
      totalInventario: 0,
    };
    const invoke = vi.fn(async (): Promise<ControllerResponse<unknown>> => ({
      ok: true,
      data,
    }));

    await expect(
      loadInventoryValuation(invoke as typeof window.appApi.invoke, "worker"),
    ).resolves.toEqual(data);
    expect(invoke).toHaveBeenCalledWith("inventario:valorizacion", {
      usuarioId: "worker",
    });

    const failingInvoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({
        ok: false,
        error: { code: "DATABASE_ERROR", message: "Consulta fallida" },
      }),
    );
    await expect(
      loadInventoryValuation(
        failingInvoke as typeof window.appApi.invoke,
        "worker",
      ),
    ).rejects.toThrow("Consulta fallida");
  });

  it("formats CLP values and Chilean thousands separators", () => {
    expect(formatInventoryCurrency(1_234_567)).toBe(
      new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0,
      }).format(1_234_567),
    );
    expect(formatInventoryCount(12_345)).toBe(
      new Intl.NumberFormat("es-CL").format(12_345),
    );
  });

  it("renders the grand total and normal category breakdown", () => {
    const markup = renderToStaticMarkup(
      createElement(InventoryValuationContent, {
        result: {
          categorias: [
            {
              categoriaId: 1,
              categoria: "Abarrotes",
              cantidadProductos: 1_234,
              stockTotal: 5_678,
              valorTotal: 1_500_000,
            },
          ],
          totalInventario: 1_500_000,
        },
      }),
    );

    expect(markup).toContain("Valor total a costo");
    expect(markup).toContain("Abarrotes");
    expect(markup).toContain(formatInventoryCount(1_234));
    expect(markup).toContain(formatInventoryCount(5_678));
    expect(markup).toContain(formatInventoryCurrency(1_500_000));
  });

  it("keeps headers visible and shows a zero total for an empty result", () => {
    const markup = renderToStaticMarkup(
      createElement(InventoryValuationContent, {
        result: { categorias: [], totalInventario: 0 },
      }),
    );

    expect(markup).toContain("Categoría");
    expect(markup).toContain("Cantidad de productos");
    expect(markup).toContain("Stock total");
    expect(markup).toContain("Valor total");
    expect(markup).toContain(formatInventoryCurrency(0));
    expect(markup).toContain("No hay existencias disponibles para valorizar.");
    expect(isImplementedViewNodeId("inventory-valuation")).toBe(true);
  });
});
