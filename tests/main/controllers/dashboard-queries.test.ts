import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateSaleAmount,
  loadAttendanceSummary,
  loadCashSummary,
  loadDailySalesSummary,
  loadExpirationAlerts,
  loadStockAlerts,
  type DashboardDb,
} from '../../../src/main/controllers/dashboard-service';
import {
  createDashboardRequest,
  getAttendanceDisplay,
  shouldShowExpirationAlerts,
} from '../../../src/renderer/src/views/DashboardView';

const allMock = vi.fn();
const database: DashboardDb = {
  all: allMock,
};

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

    await expect(loadStockAlerts(database)).resolves.toEqual([
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
      database,
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
        paymentMethod: 'efectivo',
        discountType: 'ninguno',
        discountValue: null,
        subtotal: 10_000,
      },
      {
        state: 'completada',
        paymentMethod: 'debito',
        discountType: 'monto',
        discountValue: 500,
        subtotal: 2_500,
      },
      {
        state: 'anulada',
        paymentMethod: 'efectivo',
        discountType: 'porcentaje',
        discountValue: 10,
        subtotal: 5_000,
      },
    ]);

    await expect(
      loadDailySalesSummary(database, new Date('2026-06-11T12:00:00Z')),
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
      loadAttendanceSummary(database, new Date('2026-06-11T12:00:00Z')),
    ).resolves.toEqual({
      activeWorkers: 2,
      workersWithAttendance: 1,
      workersWithoutAttendance: 1,
      pendingWorkers: [{ workerId: 2, fullName: 'Luis Soto' }],
    });
  });

  it('builds a read-only cash summary without a cash register for the day', async () => {
    allMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      loadCashSummary(database, new Date('2026-06-11T12:00:00Z')),
    ).resolves.toMatchObject({
      status: 'sin_registro',
      currentAmount: 0,
      currentTransactions: 0,
      voidedAmount: 0,
      voidedTransactions: 0,
    });
  });

  it('builds an open cash summary from current and voided sales', async () => {
    allMock
      .mockResolvedValueOnce([
        {
          state: 'completada',
          paymentMethod: 'efectivo',
          discountType: 'ninguno',
          discountValue: null,
          subtotal: 8_000,
        },
        {
          state: 'completada',
          paymentMethod: 'transferencia',
          discountType: 'monto',
          discountValue: 1_000,
          subtotal: 6_000,
        },
        {
          state: 'anulada',
          paymentMethod: 'efectivo',
          discountType: 'ninguno',
          discountValue: null,
          subtotal: 3_500,
        },
      ])
      .mockResolvedValueOnce([
        {
          status: 'abierto',
          openedAt: '2026-06-11T08:00:00.000Z',
          closedAt: null,
        },
      ]);

    await expect(
      loadCashSummary(database, new Date('2026-06-11T12:00:00Z')),
    ).resolves.toMatchObject({
      status: 'abierta',
      openedAt: '2026-06-11T08:00:00.000Z',
      currentAmount: 13_000,
      currentTransactions: 2,
      voidedAmount: 3_500,
      voidedTransactions: 1,
      byPaymentMethod: {
        efectivo: {
          currentAmount: 8_000,
          currentTransactions: 1,
          voidedAmount: 3_500,
          voidedTransactions: 1,
        },
        transferencia: {
          currentAmount: 5_000,
          currentTransactions: 1,
          voidedAmount: 0,
          voidedTransactions: 0,
        },
      },
    });
  });

  it('builds a closed cash summary when the daily register is closed', async () => {
    allMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          status: 'cerrado',
          openedAt: '2026-06-11T08:00:00.000Z',
          closedAt: '2026-06-11T20:00:00.000Z',
        },
      ]);

    await expect(
      loadCashSummary(database, new Date('2026-06-11T12:00:00Z')),
    ).resolves.toMatchObject({
      status: 'cerrada',
      openedAt: '2026-06-11T08:00:00.000Z',
      closedAt: '2026-06-11T20:00:00.000Z',
    });
  });
});

describe('dashboard presentation by role', () => {
  const globalAttendance = {
    activeWorkers: 2,
    workersWithAttendance: 1,
    workersWithoutAttendance: 1,
    pendingWorkers: [{ workerId: 2, fullName: 'Luis Soto' }],
  };

  it('requires the authenticated user in worker dashboard requests', () => {
    expect(createDashboardRequest('trabajador')).toBeNull();
    expect(createDashboardRequest('trabajador', ' usuario-luis ')).toEqual({
      role: 'trabajador',
      usuarioId: 'usuario-luis',
    });
  });

  it('shows the global attendance summary when workers are pending', () => {
    expect(getAttendanceDisplay(globalAttendance)).toEqual({
      alert: true,
      description: 'trabajadores activos con entrada registrada',
      primary: '1 de 2',
      secondary: '1 sin registro de asistencia',
      title: 'Asistencia de hoy',
    });
  });

  it('shows a positive global attendance message when all workers attended', () => {
    expect(
      getAttendanceDisplay({
        activeWorkers: 2,
        workersWithAttendance: 2,
        workersWithoutAttendance: 0,
        pendingWorkers: [],
      }),
    ).toEqual({
      alert: false,
      description: 'trabajadores activos con entrada registrada',
      primary: '2 de 2',
      secondary: 'Todos los trabajadores activos registraron asistencia',
      title: 'Asistencia de hoy',
    });
  });

  it('hides expiration alerts only when both lists are empty', () => {
    expect(
      shouldShowExpirationAlerts({ expired: [], expiringSoon: [] }),
    ).toBe(false);
    expect(
      shouldShowExpirationAlerts({
        expired: [],
        expiringSoon: [
          {
            lotId: 'lot-1',
            productName: 'Yogur',
            ean13: '7800000000124',
            availableQuantity: 6,
            expirationDate: '2026-06-11',
            daysRemaining: 0,
          },
        ],
      }),
    ).toBe(true);
  });
});
