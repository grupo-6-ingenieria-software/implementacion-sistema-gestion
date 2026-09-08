import { describe, expect, it } from "vitest";
import { controllers } from "../../../src/shared/controllers";
import type {
  ProductCreatePayload,
  ProductEditPayload,
} from "../../../src/shared/products";
import {
  ProductWriteError,
  createProductWriteController,
  normalizeCreatePayload,
  normalizeEditPayload,
  validateCreatePayload,
  validateEditPayload,
} from "../../../src/main/controllers/product-write";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";

const validCreatePayload: ProductCreatePayload = {
  usuarioId: "12345678-9",
  ean13: "7802920000015",
  nombre: "Producto valido",
  categoriaId: 1,
  precioCosto: 1000,
  precioVenta: 1500,
  stockMinimo: 5,
};

const validEditPayload: ProductEditPayload = {
  ...validCreatePayload,
  originalEan13: validCreatePayload.ean13,
};

describe("product write controllers", () => {
  it("creates a valid product payload", async () => {
    const controller = createProductWriteController({
      channel: "producto:registrar",
      controllerId: "product-create",
      dependencies: {
        save: async (payload: ProductCreatePayload) => ({
          ean13: payload.ean13,
        }),
      },
      metadata: controllers[9],
      normalize: normalizeCreatePayload,
    });

    const response = await controller.handle(validCreatePayload, {
      channel: "producto:registrar",
    });

    expect(response).toEqual({
      ok: true,
      data: { ean13: validCreatePayload.ean13 },
    });
  });

  it("maps authorization failures to forbidden errors", async () => {
    const controller = createProductWriteController({
      channel: "producto:registrar",
      controllerId: "product-create",
      dependencies: {
        save: async () => {
          throw new AccessDeniedError();
        },
      },
      metadata: controllers[9],
      normalize: normalizeCreatePayload,
    });

    const response = await controller.handle(
      {
        ...validCreatePayload,
        usuarioId: "23456789-0",
      },
      { channel: "producto:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden product write");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("rejects invalid EAN-13 and price rules", async () => {
    const controller = createProductWriteController({
      channel: "producto:registrar",
      controllerId: "product-create",
      dependencies: {
        save: async (payload: ProductCreatePayload) => {
          throw new ProductWriteError(
            "validation",
            "Revise los campos marcados antes de continuar.",
            validateCreatePayload(payload),
          );
        },
      },
      metadata: controllers[9],
      normalize: normalizeCreatePayload,
    });

    const response = await controller.handle(
      {
        ...validCreatePayload,
        ean13: "123",
        nombre: " ",
        precioCosto: 1500,
        precioVenta: 1000,
      },
      { channel: "producto:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected validation failure");
    }

    expect(response.error.code).toBe("VALIDATION_ERROR");
    expect(response.error.fieldErrors).toMatchObject({
      ean13: "El codigo EAN-13 debe tener exactamente 13 digitos numericos.",
      nombre: "El nombre del producto es obligatorio.",
      precioVenta: "El precio venta debe ser mayor que el precio costo.",
    });
  });

  it("rejects decimal inventory values instead of truncating them", async () => {
    const controller = createProductWriteController({
      channel: "producto:registrar",
      controllerId: "product-create",
      dependencies: {
        save: async (payload: ProductCreatePayload) => {
          throw new ProductWriteError(
            "validation",
            "Revise los campos marcados antes de continuar.",
            validateCreatePayload(payload),
          );
        },
      },
      metadata: controllers[9],
      normalize: normalizeCreatePayload,
    });

    const response = await controller.handle(
      { ...validCreatePayload, precioCosto: "1000.5", stockMinimo: "2.5" },
      { channel: "producto:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected validation failure");
    expect(response.error.fieldErrors).toMatchObject({
      precioCosto: "El precio costo debe ser un entero mayor o igual a 0.",
      stockMinimo: "El stock minimo debe ser un entero mayor o igual a 0.",
    });
  });

  it("maps duplicated EAN-13 errors to field validation", async () => {
    const controller = createProductWriteController({
      channel: "producto:registrar",
      controllerId: "product-create",
      dependencies: {
        save: async () => {
          throw new ProductWriteError(
            "duplicate-ean",
            "Ya existe un producto con ese EAN-13.",
          );
        },
      },
      metadata: controllers[9],
      normalize: normalizeCreatePayload,
    });

    const response = await controller.handle(validCreatePayload, {
      channel: "producto:registrar",
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected duplicated EAN failure");
    }

    expect(response.error.fieldErrors).toMatchObject({
      ean13: "Ya existe un producto con ese EAN-13.",
    });
  });

});
