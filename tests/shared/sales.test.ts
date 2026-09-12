import { describe, expect, it } from "vitest";
import {
  calculateCashChange,
  calculateSaleTotals,
  formatChileanPeso,
  getChileDateKey,
  isValidSaleHistoryDate,
  isValidSaleId,
  parseSaleDiscountAmount,
  validateSaleDiscount,
} from "../../src/shared/sales";

describe("Chilean peso formatting", () => {
  it("uses the literal format defined by Documento 0", () => {
    expect(formatChileanPeso(0)).toBe("$ 0");
    expect(formatChileanPeso(990)).toBe("$ 990");
    expect(formatChileanPeso(1_250_000)).toBe("$ 1.250.000");
  });
});

describe("CU38 sale identifier validation", () => {
  it("accepts complete UUID identifiers regardless of hexadecimal case", () => {
    expect(isValidSaleId("00000000-0000-4000-8000-000000000401")).toBe(true);
    expect(isValidSaleId(" AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE ")).toBe(true);
  });

  it.each([
    "",
    "venta-1",
    "00000000-0000-4000-8000-00000000040",
    "00000000-0000-4000-8000-00000000040z",
  ])("rejects malformed identifiers: %s", (value) => {
    expect(isValidSaleId(value)).toBe(false);
  });
});

describe("CU41 sale history dates", () => {
  it("uses the Chilean calendar day", () => {
    expect(getChileDateKey(new Date("2026-09-12T02:30:00.000Z"))).toBe(
      "2026-09-11",
    );
  });

  it.each(["2026-09-11", "2024-02-29"])(
    "accepts a real ISO date: %s",
    (value) => {
      expect(isValidSaleHistoryDate(value)).toBe(true);
    },
  );

  it.each(["", "11-09-2026", "2026-02-29", "2026-13-01", "2026-9-1"])(
    "rejects an invalid date: %s",
    (value) => {
      expect(isValidSaleHistoryDate(value)).toBe(false);
    },
  );
});

describe("sale totals", () => {
  it("calculates subtotal, discount and total", () => {
    expect(
      calculateSaleTotals(
        [
          { cantidad: 2, precioUnitario: 1000 },
          { cantidad: 1, precioUnitario: 500 },
        ],
        300,
      ),
    ).toEqual({
      subtotal: 2500,
      descuento: 300,
      total: 2200,
    });
  });

  it("rejects discounts above subtotal instead of silently changing them", () => {
    expect(() =>
      calculateSaleTotals([{ cantidad: 1, precioUnitario: 1000 }], 5000),
    ).toThrow("mayor al subtotal");
    expect(calculateCashChange(1750, 2000)).toBe(250);
  });
});

describe("CU37 discount validation", () => {
  it.each([
    ["1500", 1500],
    ["1.500", 1500],
    ["1.500.000", 1500000],
    ["0", 0],
    [" 1500 ", 1500],
  ])("parses %s as %d CLP", (text, expected) => {
    expect(parseSaleDiscountAmount(text)).toBe(expected);
  });
  it.each([
    "",
    " ",
    "-1",
    "1.5",
    "1,5",
    "15.00",
    "1.0000",
    "1e3",
    "abc",
    "+100",
    "1 500",
    "9007199254740992",
  ])("rejects invalid text %s", (text) => {
    expect(parseSaleDiscountAmount(text)).toBeNull();
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid numeric amount %s",
    (amount) => {
      expect(
        validateSaleDiscount(amount, "Promoción", 3000).monto,
      ).toBeTruthy();
      expect(() =>
        calculateSaleTotals([{ cantidad: 1, precioUnitario: 3000 }], amount),
      ).toThrow();
    },
  );
  it("requires a reason only for positive amounts and accepts the subtotal boundary", () => {
    expect(validateSaleDiscount(0, "", 3000)).toEqual({});
    expect(validateSaleDiscount(500, " \t\n ", 3000).razon).toBeTruthy();
    expect(validateSaleDiscount(3000, "Promoción", 3000)).toEqual({});
    expect(
      calculateSaleTotals([{ cantidad: 3, precioUnitario: 1000 }], 3000).total,
    ).toBe(0);
  });
});
