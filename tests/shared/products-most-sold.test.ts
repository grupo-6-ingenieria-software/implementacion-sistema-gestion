import { describe, expect, it } from "vitest";
import { allocateRecordedSaleNet } from "../../src/shared/sales";
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
    const input = [{ lineId: "b", subtotal: 100 }, { lineId: "a", subtotal: 100 }, { lineId: "c", subtotal: 100 }];
    const result = allocateRecordedSaleNet(input, 299);
    expect(result).toEqual([
      { ...input[0], descuento: 0, neto: 100 },
      { ...input[1], descuento: 1, neto: 99 },
      { ...input[2], descuento: 0, neto: 100 },
    ]);
    expect(result.reduce((sum, line) => sum + line.neto, 0)).toBe(299);
    expect(allocateRecordedSaleNet(input, 300).every((line) => line.descuento === 0)).toBe(true);
    expect(allocateRecordedSaleNet(input, 0).every((line) => line.neto === 0)).toBe(true);
  });

  it("rejects incoherent monetary data", () => {
    expect(() => allocateRecordedSaleNet([{ lineId: "a", subtotal: 10 }], 11)).toThrow();
    expect(() => allocateRecordedSaleNet([{ lineId: "a", subtotal: 10 }, { lineId: "a", subtotal: 10 }], 10)).toThrow();
    expect(() => allocateRecordedSaleNet([{ lineId: "a", subtotal: 0 }], 1)).toThrow();
    expect(allocateRecordedSaleNet([{ lineId: "a", subtotal: 0 }], 0)[0].neto).toBe(0);
  });
});
