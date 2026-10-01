import { describe, expect, it } from "vitest";
import { allocateRecordedSaleNetAmounts } from "../../src/shared/sales";
import {
  formatProductsMostSoldDisplayDate,
  formatProductsMostSoldPercentage,
  parseProductsMostSoldDisplayDate,
  parseProductsMostSoldPeriod,
} from "../../src/shared/products-most-sold";

describe("CU48 shared contract and integer discount allocation", () => {
  it("validates real Chilean display dates and inclusive period order", () => {
    expect(parseProductsMostSoldDisplayDate("29/02/2024")).toBe("2024-02-29");
    expect(parseProductsMostSoldDisplayDate("29/02/2026")).toBeNull();
    expect(parseProductsMostSoldDisplayDate("2026-09-30")).toBeNull();
    expect(formatProductsMostSoldDisplayDate("2026-09-30")).toBe("30/09/2026");
    expect(parseProductsMostSoldPeriod({ fechaInicio: "2026-09-30", fechaTermino: "2026-09-30" })).toEqual({ fechaInicio: "2026-09-30", fechaTermino: "2026-09-30" });
    expect(() => parseProductsMostSoldPeriod({ fechaInicio: "2026-10-01", fechaTermino: "2026-09-30" })).toThrow("La fecha de inicio no puede ser posterior a la fecha de término");
    expect(() => parseProductsMostSoldPeriod({ fechaInicio: "2026-02-30", fechaTermino: "2026-09-30" })).toThrow();
    expect(formatProductsMostSoldPercentage(100 / 3)).toBe("33,33 %");
  });

  it("distributes residual pesos by largest remainder and stable detail id", () => {
    const input = [{ id: "b", subtotal: 100 }, { id: "a", subtotal: 100 }, { id: "c", subtotal: 100 }];
    const result = allocateRecordedSaleNetAmounts({ discountType: "monto", discountValue: 1 }, input);
    expect(result).toEqual([
      { ...input[0], descuento: 0, montoNeto: 100 },
      { ...input[1], descuento: 1, montoNeto: 99 },
      { ...input[2], descuento: 0, montoNeto: 100 },
    ]);
    expect(result.reduce((sum, line) => sum + line.montoNeto, 0)).toBe(299);
    expect(allocateRecordedSaleNetAmounts({ discountType: "ninguno", discountValue: null }, input).every((line) => line.descuento === 0)).toBe(true);
    expect(allocateRecordedSaleNetAmounts({ discountType: "monto", discountValue: 300 }, input).every((line) => line.montoNeto === 0)).toBe(true);
  });

  it("rejects incoherent monetary data", () => {
    expect(() => allocateRecordedSaleNetAmounts({ discountType: "monto", discountValue: 11 }, [{ id: "a", subtotal: 10 }])).toThrow();
    expect(() => allocateRecordedSaleNetAmounts({ discountType: "monto", discountValue: 10 }, [{ id: "a", subtotal: 10 }, { id: "a", subtotal: 10 }])).toThrow();
    expect(() => allocateRecordedSaleNetAmounts({ discountType: "monto", discountValue: 1 }, [{ id: "a", subtotal: 0 }])).toThrow();
    expect(allocateRecordedSaleNetAmounts({ discountType: "ninguno", discountValue: null }, [{ id: "a", subtotal: 0 }])[0].montoNeto).toBe(0);
  });
});
