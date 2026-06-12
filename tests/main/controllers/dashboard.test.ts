import { describe, expect, it, vi } from 'vitest';

const allMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/db/client', () => ({
  db: {
    all: allMock,
  },
}));

import { dashboardController } from '../../../src/main/controllers/dashboard';
import { attendanceController } from '../../../src/main/controllers/attendance';

describe('dashboard controller', () => {
  it('rejects requests without a supported development role', async () => {
    await expect(
      dashboardController.handle({}, { channel: 'dashboard:cargar' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'dashboard',
        message: 'Se requiere una sesion valida para cargar el dashboard.',
      },
    });
  });

  it('rejects worker dashboard requests without an authenticated user', async () => {
    await expect(
      dashboardController.handle(
        { role: 'trabajador' },
        { channel: 'dashboard:cargar' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'dashboard',
        message: 'Se requiere una sesion valida para cargar el dashboard.',
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
        { role: 'trabajador', usuarioId: 'trabajador-1' },
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

describe('dashboard attendance controller', () => {
  it('rejects worker summaries without an authenticated user', async () => {
    await expect(
      attendanceController.handle(
        { role: 'trabajador' },
        { channel: 'asistencia:resumen-dashboard' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'attendance',
        message:
          'Se requiere una sesion valida para cargar el resumen de asistencia.',
      },
    });
  });

  it('returns the same global attendance summary for owner and worker', async () => {
    const attendanceRows = [
      { workerId: 1, fullName: 'Ana Perez', hasAttendance: 1 },
      { workerId: 2, fullName: 'Luis Soto', hasAttendance: 0 },
    ];
    allMock
      .mockResolvedValueOnce(attendanceRows)
      .mockResolvedValueOnce(attendanceRows);

    const workerResponse = await attendanceController.handle(
      { role: 'trabajador', usuarioId: 'usuario-luis' },
      { channel: 'asistencia:resumen-dashboard' },
    );
    const ownerResponse = await attendanceController.handle(
      { role: 'dueno', usuarioId: 'usuario-dueno' },
      { channel: 'asistencia:resumen-dashboard' },
    );

    expect(workerResponse).toMatchObject({
      ok: true,
      data: {
        activeWorkers: 2,
        workersWithAttendance: 1,
        workersWithoutAttendance: 1,
        pendingWorkers: [{ workerId: 2, fullName: 'Luis Soto' }],
      },
    });
    expect(ownerResponse).toEqual(workerResponse);
  });
});
