import { describe, expect, it, vi } from "vitest";
import { createSaleController } from "../../../src/main/controllers/sale";

function dependencies(state: "sin_registro" | "abierta" | "cerrada") {
  const inspectCash = vi
    .fn()
    .mockResolvedValue(
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

  it("gives a closed cash register priority over a malformed cart", async () => {
    const deps = dependencies("cerrada");
    const controller = createSaleController(deps as never);
    const response = await controller.handle(
      { items: "malformado", metodoPago: "cheque" },
      { channel: "venta:registrar" },
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE" },
    });
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.inspectCash).toHaveBeenCalledOnce();
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
});
