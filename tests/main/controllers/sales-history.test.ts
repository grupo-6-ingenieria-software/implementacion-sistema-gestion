import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSalesHistoryController,
  loadDailySalesHistory,
  type SalesHistoryDb,
} from '../../../src/main/controllers/sales-history';

const allMock = vi.fn();
const database: SalesHistoryDb = {
  all: allMock,
};
const dialect = new SQLiteSyncDialect();

beforeEach(() => {
  allMock.mockReset();
});

describe('daily sales history query', () => {
  it('uses Chile winter boundaries and orders newest sales first', async () => {
    allMock.mockResolvedValueOnce([]);

    await loadDailySalesHistory(
      database,
      new Date('2026-06-11T12:00:00Z'),
    );

    const query = toQuery(allMock.mock.calls[0][0]);

    expect(query.params).toEqual([
      '2026-06-11 04:00:00',
      '2026-06-12 04:00:00',
    ]);
    expect(query.sql).toContain(
      'ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC',
    );
  });

  it('uses Chile summer boundaries', async () => {
    allMock.mockResolvedValueOnce([]);

    await loadDailySalesHistory(
      database,
      new Date('2026-01-15T12:00:00Z'),
    );

    expect(toQuery(allMock.mock.calls[0][0]).params).toEqual([
      '2026-01-15 03:00:00',
      '2026-01-16 03:00:00',
    ]);
  });

  it('maps sales and excludes voided sales from current totals', async () => {
    allMock.mockResolvedValueOnce([
      {
        ventaId: 'venta-3',
        fechaHora: '2026-06-11T18:30:00.000Z',
        trabajadorResponsable: 'Maria Huascar',
        cantidadProductos: '3',
        subtotal: '5000',
        metodoPago: 'debito',
        estado: 'completada',
        discountType: 'monto',
        discountValue: '500',
      },
      {
        ventaId: 'venta-2',
        fechaHora: '2026-06-11T17:00:00.000Z',
        trabajadorResponsable: 'Luis Soto',
        cantidadProductos: '2',
        subtotal: '10000',
        metodoPago: 'efectivo',
        estado: 'anulada',
        discountType: 'porcentaje',
        discountValue: '10',
      },
      {
        ventaId: 'venta-1',
        fechaHora: '2026-06-11T15:00:00.000Z',
        trabajadorResponsable: 'Maria Huascar',
        cantidadProductos: '1',
        subtotal: '2000',
        metodoPago: 'efectivo',
        estado: 'completada',
        discountType: 'ninguno',
        discountValue: null,
      },
    ]);

    await expect(
      loadDailySalesHistory(
        database,
        new Date('2026-06-11T12:00:00Z'),
      ),
    ).resolves.toEqual({
      ventas: [
        {
          ventaId: 'venta-3',
          fechaHora: '2026-06-11T18:30:00.000Z',
          trabajadorResponsable: 'Maria Huascar',
          cantidadProductos: 3,
          total: 4500,
          metodoPago: 'debito',
          estado: 'completada',
        },
        {
          ventaId: 'venta-2',
          fechaHora: '2026-06-11T17:00:00.000Z',
          trabajadorResponsable: 'Luis Soto',
          cantidadProductos: 2,
          total: 9000,
          metodoPago: 'efectivo',
          estado: 'anulada',
        },
        {
          ventaId: 'venta-1',
          fechaHora: '2026-06-11T15:00:00.000Z',
          trabajadorResponsable: 'Maria Huascar',
          cantidadProductos: 1,
          total: 2000,
          metodoPago: 'efectivo',
          estado: 'completada',
        },
      ],
      resumen: {
        ventasVigentes: 2,
        montoVigente: 6500,
        porMetodoPago: {
          efectivo: { cantidadVentas: 1, monto: 2000 },
          debito: { cantidadVentas: 1, monto: 4500 },
          credito: { cantidadVentas: 0, monto: 0 },
          transferencia: { cantidadVentas: 0, monto: 0 },
        },
        ventasAnuladas: 1,
        montoAnulado: 9000,
      },
    });
  });

  it('returns an empty list and zeroed summary when the day has no sales', async () => {
    allMock.mockResolvedValueOnce([]);

    await expect(loadDailySalesHistory(database)).resolves.toEqual({
      ventas: [],
      resumen: {
        ventasVigentes: 0,
        montoVigente: 0,
        porMetodoPago: {
          efectivo: { cantidadVentas: 0, monto: 0 },
          debito: { cantidadVentas: 0, monto: 0 },
          credito: { cantidadVentas: 0, monto: 0 },
          transferencia: { cantidadVentas: 0, monto: 0 },
        },
        ventasAnuladas: 0,
        montoAnulado: 0,
      },
    });
  });
});

describe('sales history controller', () => {
  it('returns a technical error without exposing database details', async () => {
    const error = new Error('database connection details');
    const failingDatabase: SalesHistoryDb = {
      all: vi.fn().mockRejectedValue(error),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = createSalesHistoryController(
      failingDatabase,
      () => new Date('2026-06-11T12:00:00Z'),
    );

    await expect(
      controller.handle(undefined, { channel: 'venta:historial-dia' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TECHNICAL_ERROR',
        controllerId: 'sales-history',
        message: 'No fue posible cargar las ventas del dia.',
      },
    });
    expect(consoleError).toHaveBeenCalledWith(error);

    consoleError.mockRestore();
  });
});

function toQuery(query: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(query);
}
