import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../../../src/db/client', () => ({
  db: {
    all: vi.fn(),
  },
}));

import { db } from '../../../src/db/client';
import {
  calculateSaleAmount,
  loadAttendanceSummary,
  loadDailySalesSummary,
  loadExpirationAlerts,
  loadStockAlerts,
} from '../../../src/main/controllers/dashboard-queries';

const allMock = db.all as unknown as Mock;

beforeEach(() => {
  allMock.mockReset();
});

describe('daily sales calculation', () => {
  it('keeps the subtotal when there is no discount', () => {
    expect(
      calculateSaleAmount({
        state: 'completada',
        discountType: 'ninguno',
        discountValue: null,
        subtotal: 12_500,
      }),
    ).toBe(12_500);
  });

  it('applies and rounds a percentage discount to whole CLP', () => {
    expect(
      calculateSaleAmount({
        state: 'completada',
        discountType: 'porcentaje',
        discountValue: 15,
        subtotal: 1_001,
      }),
    ).toBe(851);
  });

  it('does not produce a negative amount for a fixed discount', () => {
    expect(
      calculateSaleAmount({
        state: 'anulada',
        discountType: 'monto',
        discountValue: 2_000,
        subtotal: 1_500,
      }),
    ).toBe(0);
  });
});

describe('dashboard query mapping', () => {
  it('maps stock totals returned by SQLite to numbers', async () => {
    allMock.mockResolvedValueOnce([
      {
        productName: 'Leche',
        ean13: '7802345600012',
        categoryName: 'Lacteos',
        currentStock: '8',
        minimumStock: '10',
      },
    ]);

    await expect(loadStockAlerts()).resolves.toEqual([
      {
        productName: 'Leche',
        ean13: '7802345600012',
        categoryName: 'Lacteos',
        currentStock: 8,
        minimumStock: 10,
      },
    ]);
  });

  it('separates expired lots from the fixed seven-day horizon', async () => {
    allMock.mockResolvedValueOnce([
      {
        lotId: 'expired',
        productName: 'Pan',
        ean13: '7800000000123',
        availableQuantity: 4,
        expirationDate: '2026-06-10',
      },
      {
        lotId: 'today',
        productName: 'Yogur',
        ean13: '7800000000124',
        availableQuantity: 6,
        expirationDate: '2026-06-11',
      },
      {
        lotId: 'week',
        productName: 'Queso',
        ean13: '7800000000125',
        availableQuantity: 3,
        expirationDate: '2026-06-18',
      },
    ]);

    const result = await loadExpirationAlerts(
      new Date('2026-06-11T12:00:00Z'),
    );

    expect(result.expired.map((alert) => alert.lotId)).toEqual(['expired']);
    expect(
      result.expiringSoon.map((alert) => [
        alert.lotId,
        alert.daysRemaining,
      ]),
    ).toEqual([
      ['today', 0],
      ['week', 7],
    ]);
  });

  it('separates current and voided daily sales', async () => {
    allMock.mockResolvedValueOnce([
      {
        state: 'completada',
        discountType: 'ninguno',
        discountValue: null,
        subtotal: 10_000,
      },
      {
        state: 'completada',
        discountType: 'monto',
        discountValue: 500,
        subtotal: 2_500,
      },
      {
        state: 'anulada',
        discountType: 'porcentaje',
        discountValue: 10,
        subtotal: 5_000,
      },
    ]);

    await expect(
      loadDailySalesSummary(new Date('2026-06-11T12:00:00Z')),
    ).resolves.toEqual({
      currentAmount: 12_000,
      currentTransactions: 2,
      voidedAmount: 4_500,
      voidedTransactions: 1,
    });
  });

  it('lists active workers without an attendance record', async () => {
    allMock.mockResolvedValueOnce([
      { workerId: 1, fullName: 'Ana Perez', hasAttendance: 1 },
      { workerId: 2, fullName: 'Luis Soto', hasAttendance: 0 },
    ]);

    await expect(
      loadAttendanceSummary(new Date('2026-06-11T12:00:00Z')),
    ).resolves.toEqual({
      activeWorkers: 2,
      workersWithAttendance: 1,
      workersWithoutAttendance: 1,
      pendingWorkers: [{ workerId: 2, fullName: 'Luis Soto' }],
    });
  });
});
