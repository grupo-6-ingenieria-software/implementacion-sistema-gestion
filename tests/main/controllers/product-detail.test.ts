import { describe, expect, it } from "vitest";
import type { ControllerResponse } from "../../../src/shared/controllers";
import type { Role } from "../../../src/shared/navigation";
import type { ProductDetailWithLotsResponse } from "../../../src/shared/inventory-detail";
import { createProductDetailController } from "../../../src/main/controllers/product-detail";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";

const sampleProduct: ProductDetailWithLotsResponse = {
  product: {
    ean13: "7802920000015",
    nombre: "Coca-Cola 1.5L",
    categoria: "Bebidas",
    categoriaId: 1,
    precioVenta: 1800,
    precioCosto: 1200,
    stockMinimo: 20,
    estado: "activo",
  },
  lots: [
    {
      loteId: "lote-001",
      cantidadActual: 30,
      precioCosto: 1200,
      fechaIngreso: "2026-06-01T10:00:00",
      esPerecible: false,
    },
    {
      loteId: "lote-002",
      cantidadActual: 18,
      precioCosto: 1150,
      fechaIngreso: "2026-07-15T14:30:00",
      fechaVencimiento: "2027-01-15",
      esPerecible: true,
    },
  ],
  stockTotal: 48,
};

const sampleProductWithoutCost: ProductDetailWithLotsResponse = {
  product: {
    ean13: "7802920000015",
    nombre: "Coca-Cola 1.5L",
    categoria: "Bebidas",
    categoriaId: 1,
    precioVenta: 1800,
    stockMinimo: 20,
    estado: "activo",
  },
  lots: [
    {
      loteId: "lote-001",
      cantidadActual: 30,
      fechaIngreso: "2026-06-01T10:00:00",
      esPerecible: false,
    },
    {
      loteId: "lote-002",
      cantidadActual: 18,
      fechaIngreso: "2026-07-15T14:30:00",
      fechaVencimiento: "2027-01-15",
      esPerecible: true,
    },
  ],
  stockTotal: 48,
};

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role =
    usuarioId === "dueno"
      ? "dueno"
      : usuarioId === "trabajador"
        ? "trabajador"
        : null;

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? "",
    usuarioRol: role,
    trabajadorNombre: role === "dueno" ? "Dueno Prueba" : "Trabajador Prueba",
  };
}

function createController(
  overrides: {
    findProductWithLots?: (
      ean13: string,
      includeCost: boolean,
    ) => Promise<ProductDetailWithLotsResponse | null>;
  } = {},
) {
  return createProductDetailController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    findProductWithLots:
      overrides.findProductWithLots ??
      (async (ean13, includeCost) => {
        if (ean13 !== "7802920000015") return null;
        return includeCost ? sampleProduct : sampleProductWithoutCost;
      }),
  });
}

async function invokeDetail(
  payload?: unknown,
): Promise<ControllerResponse<ProductDetailWithLotsResponse>> {
  return createController().handle(payload, {
    channel: "producto:detalle-lotes",
  }) as Promise<ControllerResponse<ProductDetailWithLotsResponse>>;
}

describe("product detail controller (C26)", () => {
  it("returns product with lots and cost for owner", async () => {
    const response = await invokeDetail({
      ean13: "7802920000015",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.product.ean13).toBe("7802920000015");
    expect(response.data.product.precioCosto).toBe(1200);
    expect(response.data.lots).toHaveLength(2);
    expect(response.data.lots[0].precioCosto).toBe(1200);
    expect(response.data.stockTotal).toBe(48);
  });

  it("omits cost data for worker", async () => {
    const response = await invokeDetail({
      ean13: "7802920000015",
      usuarioId: "trabajador",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.product).not.toHaveProperty("precioCosto");
    expect(response.data.lots[0]).not.toHaveProperty("precioCosto");
  });

  it("returns NOT_FOUND for unknown product", async () => {
    const response = await invokeDetail({
      ean13: "0000000000000",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected not found");
    expect(response.error.code).toBe("NOT_FOUND");
  });

  it("rejects request without authorized user", async () => {
    const response = await invokeDetail({
      ean13: "7802920000015",
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected forbidden");
    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("rejects request without EAN-13", async () => {
    const response = await invokeDetail({
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected validation error");
    expect(response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects request with empty EAN-13", async () => {
    const response = await invokeDetail({
      ean13: "   ",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected validation error");
    expect(response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects request on invalid IPC channel", async () => {
    const response = await createController().handle(
      { ean13: "7802920000015", usuarioId: "dueno" },
      { channel: "canal:invalido" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });

  it("returns DATABASE_ERROR when dependency throws unexpected error", async () => {
    const controller = createController({
      findProductWithLots: async () => {
        throw new Error("Connection lost");
      },
    });

    const response = await controller.handle(
      { ean13: "7802920000015", usuarioId: "dueno" },
      { channel: "producto:detalle-lotes" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR" },
    });
  });

  it("includes perishable lot expiration dates", async () => {
    const response = await invokeDetail({
      ean13: "7802920000015",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    const perishableLot = response.data.lots.find((l) => l.esPerecible);
    expect(perishableLot?.fechaVencimiento).toBe("2027-01-15");

    const nonPerishableLot = response.data.lots.find((l) => !l.esPerecible);
    expect(nonPerishableLot?.fechaVencimiento).toBeUndefined();
  });
});
