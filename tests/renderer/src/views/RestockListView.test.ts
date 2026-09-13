import { describe, expect, it, vi } from "vitest";
import {
  exportRestockList,
  loadRestockList,
} from "../../../../src/renderer/src/views/RestockListView";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import type { ControllerResponse } from "../../../../src/shared/controllers";

describe("CU16 restock renderer helpers", () => {
  it("loads automatically through C32 with identity only", async () => {
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
    ["pdf", "reporte:exportar-pdf"],
    ["xlsx", "reporte:exportar-xlsx"],
  ] as const)("exports %s without sending rows, paths or headers", async (format, channel) => {
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

  it("exposes backend errors and marks V25 as implemented", async () => {
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
