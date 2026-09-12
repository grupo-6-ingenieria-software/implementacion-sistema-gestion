import { describe, expect, it, vi } from "vitest";
import { createSaleController } from "../../../src/main/controllers/sale";
import {
  SaleBusinessError,
  SaleValidationError,
} from "../../../src/main/controllers/sale-service";

const saleContext = {
  channel: "venta:registrar",
  claims: {
    usuarioId: "12345678-9",
    sesionId: "00000000-0000-4000-8000-000000000091",
    rol: "trabajador" as const,
    usuarioRol: "trabajador",
    passwordTemporal: false,
  },
};

function dependencies(state: "sin_registro" | "abierta" | "cerrada") {
  const inspectCash = vi.fn().mockResolvedValue(
    state === "sin_registro"
      ? { status: "sin_registro" }
      : state === "abierta"
        ? {
            status: "abierta",
            cierreCajaId: "caja-1",
            openedAt: "2026-06-12T08:00:00.000Z",
          }
        : {
            status: "cerrada",
            cierreCajaId: "caja-1",
            openedAt: "2026-06-12T08:00:00.000Z",
            closedAt: "2026-06-12T20:00:00.000Z",
          },
  );
  return {
    inspectCash,
    register: vi.fn().mockResolvedValue({ ventaId: "venta-1" }),
    searchProducts: vi.fn().mockResolvedValue([]),
    validateCart: vi.fn().mockResolvedValue({ lines: [], subtotal: 0 }),
    notify: vi.fn(),
  };
}

describe("saleController contracts", () => {
  it("CU37 maps a rejected discount to validation error without notifying", async () => {
    const deps = dependencies("abierta");
    deps.register.mockRejectedValueOnce(
      new SaleValidationError(
        "El descuento no puede ser mayor al subtotal de la venta.",
      ),
    );
    const response = await createSaleController(deps as never).handle(
      { descuento: { monto: 5000, razon: "Promoción" } },
      saleContext,
    );
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("mayor al subtotal"),
      },
    });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("CU37 notifies only after the discounted sale resolves", async () => {
    const deps = dependencies("abierta");
    let finish!: (value: { ventaId: string }) => void;
    deps.register.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = createSaleController(deps as never).handle(
      { descuento: { monto: 500, razon: "Promoción" } },
      saleContext,
    );
    await vi.waitFor(() => expect(deps.register).toHaveBeenCalledOnce());
    expect(deps.notify).not.toHaveBeenCalled();
    finish({ ventaId: "venta-cu37" });
    expect(await request).toMatchObject({ ok: true });
    expect(deps.notify).toHaveBeenCalledOnce();
  });
  it.each(["sin_registro", "abierta", "cerrada"] as const)(
    "returns the discriminated daily cash state %s without opening cash",
    async (status) => {
      const deps = dependencies(status);
      const controller = createSaleController(deps as never);
      const response = await controller.handle(
        {},
        { channel: "venta:verificar-caja" },
      );
      expect(response).toMatchObject({ ok: true, data: { status } });
      expect(deps.register).not.toHaveBeenCalled();
    },
  );

  it("maps a transactional closed-cash rejection without using the preflight read", async () => {
    const deps = dependencies("cerrada");
    deps.register.mockRejectedValueOnce(
      new SaleBusinessError(
        "La caja de este día ya fue cerrada. No es posible registrar nuevas ventas.",
      ),
    );
    const controller = createSaleController(deps as never);
    const response = await controller.handle(
      { items: "malformado", metodoPago: "cheque" },
      saleContext,
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE" },
    });
    expect(deps.register).toHaveBeenCalledOnce();
    expect(deps.inspectCash).not.toHaveBeenCalled();
  });

  it("exposes the read-only cart validation result through its own channel", async () => {
    const deps = dependencies("sin_registro");
    deps.validateCart.mockResolvedValueOnce({
      lines: [{ productoId: 1, cantidad: 2, stockDisponible: 4 }],
      subtotal: 2000,
    });
    const controller = createSaleController(deps as never);
    const payload = { items: [{ productoId: 1, cantidad: 2 }] };
    const response = await controller.handle(payload, {
      channel: "venta:validar-carrito",
    });
    expect(response).toMatchObject({ ok: true, data: { subtotal: 2000 } });
    expect(deps.validateCart).toHaveBeenCalledWith(expect.anything(), payload);
    expect(deps.inspectCash).not.toHaveBeenCalled();
  });

  it("CU43 strips spoofed identity and builds the actor from trusted claims", async () => {
    const deps = dependencies("abierta");
    await createSaleController(deps as never).handle(
      {
        usuarioId: "atacante",
        nombre: "Nombre falso",
        rol: "dueno",
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: "debito",
      },
      saleContext,
    );

    expect(deps.register).toHaveBeenCalledWith(
      expect.anything(),
      {
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: "debito",
        montoRecibido: undefined,
        descuento: undefined,
      },
      {
        usuarioId: "12345678-9",
        sesionId: "00000000-0000-4000-8000-000000000091",
        rol: "trabajador",
      },
    );
  });

  it("CU43 rejects registration when trusted claims are absent", async () => {
    const deps = dependencies("abierta");
    const response = await createSaleController(deps as never).handle(
      { items: [{ productoId: 1, cantidad: 1 }], metodoPago: "debito" },
      { channel: "venta:registrar" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
