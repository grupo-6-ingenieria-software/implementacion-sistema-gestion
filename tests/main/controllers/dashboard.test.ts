import { describe, expect, it, vi } from 'vitest';

const allMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/db/client', () => ({
  db: {
    all: allMock,
  },
}));

import { dashboardController } from '../../../src/main/controllers/dashboard';

describe('dashboard controller', () => {
  it('rejects requests without a supported development role', async () => {
    await expect(
      dashboardController.handle({}, { channel: 'dashboard:cargar' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'dashboard',
        message: 'Se requiere un rol valido para cargar el dashboard.',
      },
    });
  });

  it('loads dashboard data for a supported development role', async () => {
    allMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await dashboardController.handle(
      { role: 'dueno' },
      { channel: 'dashboard:cargar' },
    );

    expect(response.ok).toBe(true);
    expect(response).toMatchObject({
      ok: true,
      data: {
        sales: {
          currentAmount: 0,
          currentTransactions: 0,
          voidedAmount: 0,
          voidedTransactions: 0,
        },
        cashSummary: {
          status: 'sin_registro',
          currentAmount: 0,
          currentTransactions: 0,
          voidedAmount: 0,
          voidedTransactions: 0,
          byPaymentMethod: {
            efectivo: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
            debito: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
            credito: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
            transferencia: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
          },
        },
        stockAlerts: [],
        expirationAlerts: {
          expired: [],
          expiringSoon: [],
        },
        attendance: {
          activeWorkers: 0,
          workersWithAttendance: 0,
          workersWithoutAttendance: 0,
          pendingWorkers: [],
        },
      },
    });
  });

  it('returns a technical error when dashboard data cannot be read', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    allMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      dashboardController.handle(
        { role: 'trabajador' },
        { channel: 'dashboard:cargar' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TECHNICAL_ERROR',
        controllerId: 'dashboard',
        message: 'No fue posible cargar la informacion solicitada.',
      },
    });

    consoleError.mockRestore();
  });
});
