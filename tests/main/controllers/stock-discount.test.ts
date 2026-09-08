import { describe, expect, it, vi } from 'vitest';
import {
  applyStockDiscount,
  planStockDiscount,
  StockDiscountBusinessError,
} from '../../../src/main/controllers/stock-discount';

describe('C17 stock discount service', () => {
  it('plans FEFO before persistence and applies UPDATE before venta_lote', async () => {
    const all = vi.fn()
      .mockResolvedValueOnce([{ available: 7, sufficient: 1 }])
      .mockResolvedValueOnce([
        { loteId: 'late', cantidadActual: 5, fechaIngreso: '2026-01-01' },
        { loteId: 'early', cantidadActual: 2, fechaIngreso: '2026-02-01' },
      ])
      .mockResolvedValueOnce([
        { loteId: 'late', fechaVencimiento: '2026-09-10' },
        { loteId: 'early', fechaVencimiento: '2026-09-01' },
      ]);
    const operations: string[] = [];
    const run = vi.fn(async (query) => {
      const text = query.queryChunks.map((chunk: { value?: string[] }) => chunk.value?.join('') ?? '').join('');
      operations.push(text.includes('UPDATE lote') ? 'update' : 'insert');
      return { rowsAffected: 1 };
    });

    const plan = await planStockDiscount({ all }, [
      { productoId: 1, cantidad: 3, exigeVencimiento: true },
    ]);
    expect(plan.map(({ loteId, cantidad }) => ({ loteId, cantidad }))).toEqual([
      { loteId: 'early', cantidad: 2 },
      { loteId: 'late', cantidad: 1 },
    ]);

    await applyStockDiscount({ run }, 'venta-1', plan);
    expect(operations).toEqual(['update', 'insert', 'update', 'insert']);
  });

  it('rechaza stock insuficiente durante la planificación sin ejecutar escrituras', async () => {
    const all = vi.fn()
      .mockResolvedValueOnce([{ available: 2, sufficient: 0 }]);
    const run = vi.fn();
    const database = { all, run };

    await expect(
      planStockDiscount(database, [
        { productoId: 1, cantidad: 3, exigeVencimiento: true },
      ]),
    ).rejects.toBeInstanceOf(StockDiscountBusinessError);
    expect(run).not.toHaveBeenCalled();
  });
});
