import { describe, expect, it } from "vitest";
import { checkedAdd, checkedMultiply, NumericRangeError, parseClpAmount, parseIntegerInput, roundClpPercentage, safeInteger } from "../../src/shared/numbers";
import { normalizeProductFormPayload } from "../../src/shared/products";
import { normalizeLotRegisterPayload } from "../../src/shared/lots";
import { normalizeSupplierOrderReceptionPayload } from "../../src/shared/supplier-orders";

describe("precisión de CLP y unidades", () => {
  it("interpreta miles de forma consistente en producto, lote y recepción", () => {
    const product = normalizeProductFormPayload({ precioCosto: "500.000", precioVenta: "600.000" });
    expect(product.precioCosto).toBe(500000);
    expect(product.precioVenta).toBe(600000);
    expect(normalizeLotRegisterPayload({ precioCosto: "500.000" }).precioCosto).toBe(500000);
    expect(normalizeSupplierOrderReceptionPayload({ lineas: [{ precioCosto: "500.000" }] }).lineas[0].precioCosto).toBe(500000);
  });
  it("rechaza fracciones de unidades que Number redondearía a un entero seguro", () => {
    for (const text of ["5000000000000000.5", "9007199254740991.1", "50000000000000005e-1", "1e-400"]) {
      expect(parseIntegerInput(text)).toBeNaN();
      expect(normalizeLotRegisterPayload({ cantidad: text }).cantidad).toBeNaN();
      expect(normalizeProductFormPayload({ stockMinimo: text }).stockMinimo).toBeNaN();
      expect(normalizeSupplierOrderReceptionPayload({ lineas: [{ cantidad: text }] }).lineas[0].cantidad).toBeNaN();
    }
    expect(parseIntegerInput("5.000")).toBe(5);
    expect(parseIntegerInput("1.5")).toBe(1.5);
    expect(parseIntegerInput("1.2e1")).toBe(12);
    expect(parseIntegerInput("0x10")).toBe(16);
    expect(parseIntegerInput("9007199254740991.000")).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each(["500000", "500.000", " 500.000 "])("interpreta %s como quinientos mil pesos", value => {
    expect(parseClpAmount(value)).toBe(500000);
  });
  it.each(["500.99", "5.00", "500,50", "1e6", "0x100", "99999999999999999", "", -1, Number.MAX_SAFE_INTEGER + 1])("rechaza dinero inválido %s", value => {
    expect(parseClpAmount(value)).toBeNull();
  });
  it("admite el límite exacto y rechaza productos o acumulaciones no seguros", () => {
    expect(safeInteger(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow(NumericRangeError);
    expect(() => checkedMultiply(500000000, 500000000)).toThrow(NumericRangeError);
  });
  it("redondea descuentos previsionales con mitad exacta hacia arriba incluso en el límite", () => {
    expect(roundClpPercentage(250, 0.6)).toBe(2);
    expect(roundClpPercentage(500000, 11.5)).toBe(57500);
    expect(roundClpPercentage(Number.MAX_SAFE_INTEGER, 100)).toBe(Number.MAX_SAFE_INTEGER);
    expect(roundClpPercentage(50000000, 1e-6)).toBe(1);
  });
});
