import { describe, expect, it } from 'vitest';
import {
  calculateCashChange,
  calculateSaleTotals,
  formatChileanPeso,
} from '../../src/shared/sales';

describe('Chilean peso formatting', () => {
  it('uses the literal format defined by Documento 0', () => {
    expect(formatChileanPeso(0)).toBe('$ 0');
    expect(formatChileanPeso(990)).toBe('$ 990');
    expect(formatChileanPeso(1_250_000)).toBe('$ 1.250.000');
  });
});

describe('sale totals', () => {
  it('calculates subtotal, discount and total', () => {
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

  it('caps discount at subtotal and calculates cash change', () => {
    expect(calculateSaleTotals([{ cantidad: 1, precioUnitario: 1000 }], 5000))
      .toEqual({
        subtotal: 1000,
        descuento: 1000,
        total: 0,
      });
    expect(calculateCashChange(1750, 2000)).toBe(250);
  });
});
