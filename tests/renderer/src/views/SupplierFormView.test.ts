import { describe, expect, it, vi } from "vitest";
import {
  loadSupplierCategories,
  loadSupplierFormData,
  toggleSupplierCategory,
} from "../../../../src/renderer/src/views/SupplierFormView";
import type { ControllerResponse } from "../../../../src/shared/controllers";

describe("helpers del formulario de proveedores CU13", () => {
  it("carga categorías a través del canal protegido del backend", async () => {
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({
        ok: true,
        data: [{ id: 1, nombre: "Abarrotes" }],
      }),
    );

    await expect(
      loadSupplierCategories(
        invoke as typeof window.appApi.invoke,
        "11111111-1",
      ),
    ).resolves.toEqual([{ id: 1, nombre: "Abarrotes" }]);
    expect(invoke).toHaveBeenCalledWith("proveedor:categorias", {
      usuarioId: "11111111-1",
    });
  });

  it("carga categorías y datos del proveedor actual juntos en modo edición", async () => {
    const detail = {
      proveedorId: 7,
      rut: "12.345.678-5",
      nombreRazonSocial: "Proveedor legado",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "ventas@proveedor.cl",
      categoriaIds: [1],
    };
    const invoke = vi.fn(
      async (channel: string): Promise<ControllerResponse<unknown>> =>
        channel === "proveedor:categorias"
          ? { ok: true, data: [{ id: 1, nombre: "Abarrotes" }] }
          : { ok: true, data: detail },
    );

    await expect(
      loadSupplierFormData(
        invoke as typeof window.appApi.invoke,
        "11111111-1",
        "12.345.678-5",
      ),
    ).resolves.toEqual({
      categories: [{ id: 1, nombre: "Abarrotes" }],
      supplier: detail,
    });
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "proveedor:categorias",
      "proveedor:buscar-existente",
    ]);
  });

  it("reporta un objetivo de edición ausente como error de carga", async () => {
    const invoke = vi.fn(
      async (channel: string): Promise<ControllerResponse<unknown>> =>
        channel === "proveedor:categorias"
          ? { ok: true, data: [] }
          : {
              ok: false,
              error: { code: "NOT_FOUND", message: "Proveedor inexistente" },
            },
    );

    await expect(
      loadSupplierFormData(
        invoke as typeof window.appApi.invoke,
        "11111111-1",
        "12345678-5",
      ),
    ).rejects.toThrow("Proveedor inexistente");
  });

  it("reporta errores de carga de categorías para que la vista ofrezca reintentar", async () => {
    const invoke = vi.fn(
      async (): Promise<ControllerResponse<unknown>> => ({
        ok: false,
        error: { code: "DATABASE_ERROR", message: "Error de categorías" },
      }),
    );

    await expect(
      loadSupplierCategories(
        invoke as typeof window.appApi.invoke,
        "11111111-1",
      ),
    ).rejects.toThrow("Error de categorías");
  });

  it("admite selección múltiple visible sin ids duplicados", () => {
    expect(toggleSupplierCategory([], 1)).toEqual([1]);
    expect(toggleSupplierCategory([1], 2)).toEqual([1, 2]);
    expect(toggleSupplierCategory([1, 2], 1)).toEqual([2]);
  });
});
