import { describe, expect, it } from "vitest";
import { allocateRecordedSaleDiscount } from "../../src/shared/sales";

describe("CU46 reparto neto por detalle", () => {
  it("conserva el total con descuento de monto y desempata restos por ID", () => {
    const lines = allocateRecordedSaleDiscount(
      [{ id: "b", subtotal: 100 }, { id: "a", subtotal: 100 }, { id: "c", subtotal: 100 }],
      { discountType: "monto", discountValue: 1 },
    );
    expect(lines).toEqual([
      { id: "b", subtotal: 100, descuento: 0, neto: 100 },
      { id: "a", subtotal: 100, descuento: 1, neto: 99 },
      { id: "c", subtotal: 100, descuento: 0, neto: 100 },
    ]);
    expect(lines.reduce((sum, line) => sum + line.neto, 0)).toBe(299);
  });

  it("aplica el total redondeado de un descuento porcentual histórico", () => {
    const lines = allocateRecordedSaleDiscount(
      [{ id: "1", subtotal: 101 }, { id: "2", subtotal: 201 }],
      { discountType: "porcentaje", discountValue: 10 },
    );
    expect(lines.reduce((sum, line) => sum + line.neto, 0)).toBe(272);
    expect(lines.reduce((sum, line) => sum + line.descuento, 0)).toBe(30);
  });

  it("maneja cero y rechaza datos inconsistentes", () => {
    expect(allocateRecordedSaleDiscount([{ id: "1", subtotal: 0 }], { discountType: "ninguno", discountValue: null }))
      .toEqual([{ id: "1", subtotal: 0, descuento: 0, neto: 0 }]);
    expect(() => allocateRecordedSaleDiscount([{ id: "1", subtotal: 100 }, { id: "1", subtotal: 20 }], { discountType: "ninguno", discountValue: null })).toThrow();
    expect(() => allocateRecordedSaleDiscount([{ id: "1", subtotal: -1 }], { discountType: "ninguno", discountValue: null })).toThrow();
    expect(() => allocateRecordedSaleDiscount([{ id: "1", subtotal: 100 }], { discountType: "monto", discountValue: 101 })).toThrow();
  });
});
