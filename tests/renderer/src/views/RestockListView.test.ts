import { describe, expect, it, vi } from "vitest";
import {
  exportRestockList,
  loadRestockList,
} from "../../../../src/renderer/src/views/RestockListView";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import type { ControllerResponse } from "../../../../src/shared/controllers";

describe("helpers del renderizador de reabastecimiento CU16", () => {
  it("carga automáticamente mediante C32 solo con identidad", async () => {
    const rows = [
      {
        nombre: "Harina",
        ean13: "7800000000001",
        categoria: "Abarrotes",
        stockActual: 1,
        stockMinimo: 4,
        cantidadSugerida: 7,
      },
    ];
    const invoke = vi.fn(async (): Promise<ControllerResponse<unknown>> => ({
      ok: true,
      data: rows,
    }));

    await expect(
      loadRestockList(invoke as typeof window.appApi.invoke, "worker"),
    ).resolves.toEqual(rows);
    expect(invoke).toHaveBeenCalledWith(
      "inventario:lista-reabastecimiento",
      { usuarioId: "worker" },
    );
  });

  it.each([
    ["pdf", "inventario:reabastecimiento:exportar-pdf"],
    ["xlsx", "inventario:reabastecimiento:exportar-xlsx"],
  ] as const)("exporta %s sin enviar filas, rutas ni encabezados", async (format, channel) => {
    const data = {
      formato: format,
      estado: "cancelled" as const,
      cantidadFilas: 1,
      fechaGeneracion: "2026-09-12T23:30:00.000Z",
    };
    const invoke = vi.fn(async (): Promise<ControllerResponse<unknown>> => ({
      ok: true,
      data,
    }));

    await expect(
      exportRestockList(
        invoke as typeof window.appApi.invoke,
        "worker",
        format,
      ),
    ).resolves.toEqual(data);
    expect(invoke).toHaveBeenCalledWith(channel, { usuarioId: "worker" });
  });

  it("expone errores del backend y marca V25 como implementado", async () => {
    const invoke = vi.fn(async (): Promise<ControllerResponse<unknown>> => ({
      ok: false,
      error: { code: "TECHNICAL_ERROR", message: "Error exportando" },
    }));
    await expect(
      exportRestockList(
        invoke as typeof window.appApi.invoke,
        "worker",
        "pdf",
      ),
    ).rejects.toThrow("Error exportando");
    expect(isImplementedViewNodeId("restock-list")).toBe(true);
  });
});
