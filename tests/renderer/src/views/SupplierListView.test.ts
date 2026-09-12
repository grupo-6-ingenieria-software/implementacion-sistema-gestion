import { describe, expect, it, vi } from "vitest";
import {
  buildSupplierEditPath,
  loadSupplierList,
} from "../../../../src/renderer/src/views/SupplierListView";
import type { ControllerResponse } from "../../../../src/shared/controllers";

describe("CU14 supplier list helpers", () => {
  it("loads the minimal list with a name or RUT search", async () => {
    const data = [
      {
        proveedorId: 3,
        rut: "12.345.678-5",
        nombreRazonSocial: "Distribuidora Sur",
      },
    ];
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({ ok: true, data }),
    );

    await expect(
      loadSupplierList(
        invoke as typeof window.appApi.invoke,
        "11111111-1",
        " 12.345.678-5 ",
      ),
    ).resolves.toEqual(data);
    expect(invoke).toHaveBeenCalledWith("proveedor:listar", {
      busqueda: "12.345.678-5",
      usuarioId: "11111111-1",
    });
  });

  it("builds an encoded edit route and exposes backend errors", async () => {
    expect(buildSupplierEditPath("12 345 678-5")).toBe(
      "/app/proveedores/12%20345%20678-5/editar",
    );
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({
        ok: false,
        error: { code: "DATABASE_ERROR", message: "Listado no disponible" },
      }),
    );
    await expect(
      loadSupplierList(invoke as typeof window.appApi.invoke, "user"),
    ).rejects.toThrow("Listado no disponible");
  });
});
