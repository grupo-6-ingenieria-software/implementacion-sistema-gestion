import { describe, expect, it } from "vitest";
import {
  allocateRecordedSaleNetAmounts,
  calculateCashChange,
  calculateSaleTotals,
  formatChileanPeso,
  getChileDateKey,
  isValidSaleHistoryDate,
  isValidSaleId,
  parseSaleDiscountAmount,
  validateSaleDiscount,
} from "../../src/shared/sales";

describe("formato de pesos chilenos", () => {
  it("usa el formato literal definido en Documento 0", () => {
    expect(formatChileanPeso(0)).toBe("$ 0");
    expect(formatChileanPeso(990)).toBe("$ 990");
    expect(formatChileanPeso(1_250_000)).toBe("$ 1.250.000");
  });
});

describe("CU45 asignación de descuentos de ventas registradas", () => {
  it("usa restos mayores y un desempate estable por identificador de línea", () => {
    expect(
      allocateRecordedSaleNetAmounts(
        { discountType: "monto", discountValue: 1 },
        [
          { id: "b", subtotal: 100 },
          { id: "a", subtotal: 100 },
        ],
      ),
    ).toEqual([
      { id: "b", subtotal: 100, descuento: 0, montoNeto: 100 },
      { id: "a", subtotal: 100, descuento: 1, montoNeto: 99 },
    ]);
  });

  it("concilia un descuento fijo entre todas las líneas de la venta", () => {
    const lines = allocateRecordedSaleNetAmounts(
      { discountType: "monto", discountValue: 101 },
      [
        { id: "a", subtotal: 100 },
        { id: "b", subtotal: 100 },
        { id: "c", subtotal: 200 },
      ],
    );
    expect(lines.map((line) => line.descuento)).toEqual([25, 25, 51]);
    expect(lines.reduce((sum, line) => sum + line.montoNeto, 0)).toBe(299);
  });

  it("deriva el descuento efectivo en CLP a partir de un porcentaje histórico", () => {
    const lines = allocateRecordedSaleNetAmounts(
      { discountType: "porcentaje", discountValue: 10 },
      [
        { id: "a", subtotal: 11 },
        { id: "b", subtotal: 10 },
      ],
    );
    expect(lines.map((line) => line.montoNeto)).toEqual([10, 9]);
  });

  it("maneja descuentos nulos y totales sin montos netos negativos", () => {
    expect(
      allocateRecordedSaleNetAmounts(
        { discountType: "ninguno", discountValue: null },
        [{ id: "a", subtotal: 0 }],
      ),
    ).toEqual([{ id: "a", subtotal: 0, descuento: 0, montoNeto: 0 }]);
    expect(
      allocateRecordedSaleNetAmounts(
        { discountType: "monto", discountValue: 300 },
        [
          { id: "a", subtotal: 100 },
          { id: "b", subtotal: 200 },
        ],
      ).map((line) => line.montoNeto),
    ).toEqual([0, 0]);
  });

  it("rechaza montos persistidos inconsistentes", () => {
    expect(() =>
      allocateRecordedSaleNetAmounts(
        { discountType: "monto", discountValue: 4 },
        [{ id: "a", subtotal: 3 }],
      ),
    ).toThrow();
  });
});

describe("CU38 validación de identificadores de venta", () => {
  it("acepta identificadores UUID completos sin distinguir mayúsculas en hexadecimal", () => {
    expect(isValidSaleId("00000000-0000-4000-8000-000000000401")).toBe(true);
    expect(isValidSaleId(" AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE ")).toBe(true);
  });

  it.each([
    "",
    "venta-1",
    "00000000-0000-4000-8000-00000000040",
    "00000000-0000-4000-8000-00000000040z",
  ])("rechaza identificadores malformados: %s", (value) => {
    expect(isValidSaleId(value)).toBe(false);
  });
});

describe("CU41 fechas del historial de ventas", () => {
  it("usa el día calendario chileno", () => {
    expect(getChileDateKey(new Date("2026-09-12T02:30:00.000Z"))).toBe(
      "2026-09-11",
    );
  });

  it.each(["2026-09-11", "2024-02-29"])(
    "acepta una fecha ISO real: %s",
    (value) => {
      expect(isValidSaleHistoryDate(value)).toBe(true);
    },
  );

  it.each(["", "11-09-2026", "2026-02-29", "2026-13-01", "2026-9-1"])(
    "rechaza una fecha inválida: %s",
    (value) => {
      expect(isValidSaleHistoryDate(value)).toBe(false);
    },
  );
});

describe("totales de venta", () => {
  it("calcula subtotal, descuento y total", () => {
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

  it("rechaza descuentos superiores al subtotal en lugar de modificarlos en silencio", () => {
    expect(() =>
      calculateSaleTotals([{ cantidad: 1, precioUnitario: 1000 }], 5000),
    ).toThrow("mayor al subtotal");
    expect(calculateCashChange(1750, 2000)).toBe(250);
  });
});

describe("CU37 validación de descuentos", () => {
  it.each([
    ["1500", 1500],
    ["1.500", 1500],
    ["1.500.000", 1500000],
    ["0", 0],
    [" 1500 ", 1500],
  ])("interpreta %s como %d CLP", (text, expected) => {
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
  ])("rechaza texto inválido %s", (text) => {
    expect(parseSaleDiscountAmount(text)).toBeNull();
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rechaza monto numérico inválido %s",
    (amount) => {
      expect(
        validateSaleDiscount(amount, "Promoción", 3000).monto,
      ).toBeTruthy();
      expect(() =>
        calculateSaleTotals([{ cantidad: 1, precioUnitario: 3000 }], amount),
      ).toThrow();
    },
  );
  it("exige motivo solo para montos positivos y acepta el límite del subtotal", () => {
    expect(validateSaleDiscount(0, "", 3000)).toEqual({});
    expect(validateSaleDiscount(500, " \t\n ", 3000).razon).toBeTruthy();
    expect(validateSaleDiscount(3000, "Promoción", 3000)).toEqual({});
    expect(
      calculateSaleTotals([{ cantidad: 3, precioUnitario: 1000 }], 3000).total,
    ).toBe(0);
  });
});
