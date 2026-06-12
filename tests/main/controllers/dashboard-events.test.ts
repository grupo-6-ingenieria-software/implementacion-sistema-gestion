import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_UPDATED_EVENT } from '../../../src/shared/dashboard';

const { send, getAllWindows, logError, registerSale } = vi.hoisted(() => {
  const sendMock = vi.fn();

  return {
    send: sendMock,
    getAllWindows: vi.fn(),
    logError: vi.fn(),
    registerSale: vi.fn(),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    error: logError,
  },
}));

vi.mock('../../../src/db/client', () => ({
  db: {},
}));

vi.mock('../../../src/main/controllers/sale-service', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/main/controllers/sale-service')
  >('../../../src/main/controllers/sale-service');

  return {
    ...actual,
    registerSale,
  };
});

import { notifyDashboardUpdated } from '../../../src/main/controllers/dashboard-events';
import {
  SaleBusinessError,
  type SaleReceipt,
} from '../../../src/main/controllers/sale-service';
import { saleController } from '../../../src/main/controllers/sale';

beforeEach(() => {
  send.mockClear();
  getAllWindows.mockReset();
  getAllWindows.mockReturnValue([{ webContents: { send } }]);
  logError.mockReset();
  registerSale.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dashboard update events', () => {
  it('emits the dashboard update event to every open window', () => {
    notifyDashboardUpdated();

    expect(getAllWindows).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });

  it('continues notifying other windows when one send fails', () => {
    const failedSend = vi.fn(() => {
      throw new Error('window closed');
    });
    const successfulSend = vi.fn();
    getAllWindows.mockReturnValue([
      { webContents: { send: failedSend } },
      { webContents: { send: successfulSend } },
    ]);

    expect(() => notifyDashboardUpdated()).not.toThrow();

    expect(failedSend).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
    expect(successfulSend).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
    expect(logError).toHaveBeenCalledWith(
      'No fue posible notificar la actualizacion del dashboard.',
      expect.any(Error),
    );
  });

  it('emits an update after a sale is registered successfully', async () => {
    registerSale.mockResolvedValueOnce(createSaleReceipt());

    const response = await saleController.handle(
      {
        usuarioId: 'usuario-1',
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: 'debito',
      },
      { channel: 'venta:registrar' },
    );

    expect(response.ok).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });

  it('keeps a successful sale response when dashboard notification fails', async () => {
    send.mockImplementationOnce(() => {
      throw new Error('renderer unavailable');
    });
    registerSale.mockResolvedValueOnce(createSaleReceipt());

    const response = await saleController.handle(
      {
        usuarioId: 'usuario-1',
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: 'debito',
      },
      { channel: 'venta:registrar' },
    );

    expect(response).toEqual({
      ok: true,
      data: createSaleReceipt(),
    });
    expect(logError).toHaveBeenCalledWith(
      'No fue posible notificar la actualizacion del dashboard.',
      expect.any(Error),
    );
  });

  it('does not emit an update when sale registration fails', async () => {
    registerSale.mockRejectedValueOnce(
      new SaleBusinessError('La caja se encuentra cerrada.'),
    );

    const response = await saleController.handle(
      {
        usuarioId: 'usuario-1',
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: 'debito',
      },
      { channel: 'venta:registrar' },
    );

    expect(response.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

function createSaleReceipt(): SaleReceipt {
  return {
    ventaId: 'venta-1',
    fechaHora: '2026-06-12T12:00:00.000Z',
    responsable: {
      usuarioId: 'usuario-1',
      nombre: 'Trabajador Prueba',
      rol: 'cajero',
    },
    metodoPago: 'debito',
    subtotal: 1000,
    descuento: {
      tipo: 'ninguno',
      valor: 0,
    },
    total: 1000,
    detalle: [],
  };
}
