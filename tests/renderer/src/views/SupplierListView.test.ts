import { describe, expect, it, vi } from "vitest";
import {
  buildSupplierListPayload,
  buildSupplierEditPath,
  loadSupplierList,
  SUPPLIER_SEARCH_DEBOUNCE_MS,
} from "../../../../src/renderer/src/views/SupplierListView";
import type { ControllerResponse } from "../../../../src/shared/controllers";

describe("helpers de la lista de proveedores de CU15", () => {
  it("carga la respuesta enriquecida con filtros combinados normalizados", async () => {
    const data = {
      suppliers: [
        {
          proveedorId: 3,
          rut: "12.345.678-5",
          nombreRazonSocial: "Distribuidora Sur",
          nombreContacto: "Ana Pérez",
          telefono: "912345678",
          correoElectronico: "ana@sur.cl",
          categorias: [{ id: 2, nombre: "Lácteos" }],
        },
      ],
      categories: [
        { id: 1, nombre: "Abarrotes" },
        { id: 2, nombre: "Lácteos" },
      ],
    };
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({ ok: true, data }),
    );

    await expect(
      loadSupplierList(
        invoke as typeof window.appApi.invoke,
        "11111111-1",
        { busqueda: " 12.345.678-5 ", categoriaId: 2 },
      ),
    ).resolves.toEqual(data);
    expect(invoke).toHaveBeenCalledWith("proveedor:listar", {
      busqueda: "12.345.678-5",
      categoriaId: 2,
      usuarioId: "11111111-1",
    });
  });

  it("normaliza un payload vacío y fija el debounce en 250 ms", () => {
    expect(
      buildSupplierListPayload(" user ", {
        busqueda: "   ",
        categoriaId: -1,
      }),
    ).toEqual({ usuarioId: "user" });
    expect(SUPPLIER_SEARCH_DEBOUNCE_MS).toBe(250);
  });

  it("construye una ruta de edición codificada y expone los errores del backend", async () => {
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
