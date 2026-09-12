import { describe, expect, it } from "vitest";
import type { ControllerResponse } from "../../../src/shared/controllers";
import type { Role } from "../../../src/shared/navigation";
import type {
  StockAdjustmentAvailability,
  StockAdjustmentResponse,
} from "../../../src/shared/inventory-detail";
import {
  createStockAdjustmentController,
  StockAdjustmentError,
} from "../../../src/main/controllers/stock-adjustment";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";

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

const sampleAvailability: StockAdjustmentAvailability = {
  ean13: "7802920000015",
  productoNombre: "Coca-Cola 1.5L",
  lots: [
    {
      loteId: "lote-001",
      cantidadActual: 30,
      precioCosto: 1200,
      fechaIngreso: "2026-06-01T10:00:00",
      esPerecible: false,
    },
  ],
};

const sampleAvailabilityNoCost: StockAdjustmentAvailability = {
  ean13: "7802920000015",
  productoNombre: "Coca-Cola 1.5L",
  lots: [
    {
      loteId: "lote-001",
      cantidadActual: 30,
      fechaIngreso: "2026-06-01T10:00:00",
      esPerecible: false,
    },
  ],
};

function createController(
  overrides: {
    executeAdjustment?: (payload: {
      ean13: string;
      loteId: string;
      cantidad: number;
      justificacion: string;
      usuarioId: string;
    }) => Promise<StockAdjustmentResponse>;
    queryAvailability?: (
      ean13: string,
      includeCost: boolean,
    ) => Promise<StockAdjustmentAvailability | null>;
  } = {},
) {
  return createStockAdjustmentController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    findActiveProduct: async () => null,
    executeAdjustment:
      overrides.executeAdjustment ??
      (async (payload) => ({
        ajusteInventarioId: "ajuste-001",
        ean13: payload.ean13,
        loteId: payload.loteId,
        cantidadAjustada: payload.cantidad,
        nuevaCantidadLote: 30 + payload.cantidad,
      })),
    queryAvailability:
      overrides.queryAvailability ??
      (async (ean13, includeCost) => {
        if (ean13 !== "7802920000015") return null;
        return includeCost ? sampleAvailability : sampleAvailabilityNoCost;
      }),
  });
}

describe("stock adjustment controller — availability channel (C27)", () => {
  it("returns availability with cost for owner", async () => {
    const response = (await createController().handle(
      { ean13: "7802920000015", usuarioId: "dueno" },
      { channel: "ajuste:disponibilidad" },
    )) as ControllerResponse<StockAdjustmentAvailability>;

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.data.productoNombre).toBe("Coca-Cola 1.5L");
    expect(response.data.lots[0].precioCosto).toBe(1200);
  });

  it("returns availability without cost for worker", async () => {
    const response = (await createController().handle(
      { ean13: "7802920000015", usuarioId: "trabajador" },
      { channel: "ajuste:disponibilidad" },
    )) as ControllerResponse<StockAdjustmentAvailability>;

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.data.lots[0]).not.toHaveProperty("precioCosto");
  });

  it("returns NOT_FOUND for unknown product", async () => {
    const response = await createController().handle(
      { ean13: "0000000000000", usuarioId: "dueno" },
      { channel: "ajuste:disponibilidad" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("rejects availability without EAN-13", async () => {
    const response = await createController().handle(
      { usuarioId: "dueno" },
      { channel: "ajuste:disponibilidad" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects availability without authorized user", async () => {
    const response = await createController().handle(
      { ean13: "7802920000015" },
      { channel: "ajuste:disponibilidad" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("stock adjustment controller — register channel (C27)", () => {
  it("registers a positive adjustment successfully", async () => {
    const response = (await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 10,
        justificacion: "Reconteo fisico",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    )) as ControllerResponse<StockAdjustmentResponse>;

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.data.cantidadAjustada).toBe(10);
    expect(response.data.nuevaCantidadLote).toBe(40);
  });

  it("registers a negative adjustment successfully", async () => {
    const response = (await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: -5,
        justificacion: "Producto danado",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    )) as ControllerResponse<StockAdjustmentResponse>;

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.data.cantidadAjustada).toBe(-5);
    expect(response.data.nuevaCantidadLote).toBe(25);
  });

  it("rejects adjustment with cantidad zero", async () => {
    const response = await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 0,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects adjustment with empty justificacion", async () => {
    const response = await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 5,
        justificacion: "",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    if (!response.ok) {
      expect(response.error.fieldErrors).toHaveProperty("justificacion");
    }
  });

  it("rejects adjustment with invalid EAN-13", async () => {
    const response = await createController().handle(
      {
        ean13: "123",
        loteId: "lote-001",
        cantidad: 5,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    if (!response.ok) {
      expect(response.error.fieldErrors).toHaveProperty("ean13");
    }
  });

  it("rejects adjustment with empty loteId", async () => {
    const response = await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "",
        cantidad: 5,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    if (!response.ok) {
      expect(response.error.fieldErrors).toHaveProperty("loteId");
    }
  });

  it("rejects adjustment that would result in negative stock", async () => {
    const controller = createController({
      executeAdjustment: async () => {
        throw new StockAdjustmentError(
          "BUSINESS_RULE",
          "El ajuste dejaria el lote con cantidad negativa.",
          { cantidad: "La cantidad resultante no puede ser negativa." },
        );
      },
    });

    const response = await controller.handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: -50,
        justificacion: "Ajuste excesivo",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE" },
    });
    if (!response.ok) {
      expect(response.error.fieldErrors).toHaveProperty("cantidad");
    }
  });

  it("rejects adjustment for non-existent product", async () => {
    const controller = createController({
      executeAdjustment: async () => {
        throw new StockAdjustmentError(
          "NOT_FOUND",
          "El producto no existe o se encuentra inactivo.",
          { ean13: "El producto no existe o se encuentra inactivo." },
        );
      },
    });

    const response = await controller.handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 5,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("rejects adjustment for invalid lot", async () => {
    const controller = createController({
      executeAdjustment: async () => {
        throw new StockAdjustmentError(
          "VALIDATION_ERROR",
          "El lote seleccionado no pertenece al producto.",
          { loteId: "El lote seleccionado no es valido para este producto." },
        );
      },
    });

    const response = await controller.handle(
      {
        ean13: "7802920000015",
        loteId: "lote-invalido",
        cantidad: 5,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects adjustment without authorized user", async () => {
    const response = await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 5,
        justificacion: "test",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("returns DATABASE_ERROR for unexpected errors", async () => {
    const controller = createController({
      executeAdjustment: async () => {
        throw new Error("Connection lost");
      },
    });

    const response = await controller.handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 5,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "ajuste:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR" },
    });
  });

  it("rejects request on invalid IPC channel", async () => {
    const response = await createController().handle(
      {
        ean13: "7802920000015",
        loteId: "lote-001",
        cantidad: 5,
        justificacion: "test",
        usuarioId: "dueno",
      },
      { channel: "canal:invalido" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });
});
