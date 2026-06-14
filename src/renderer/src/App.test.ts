import { describe, expect, it, vi } from 'vitest';
import {
  VIEW_UNAVAILABLE_MESSAGE,
  VIEW_UNAVAILABLE_TITLE,
  getLotCreateEan13,
  getProductDeleteEan13,
  getProductStatusEan13,
  getWasteCreateEan13,
  isImplementedViewNodeId,
} from './App';
import {
  buildShiftCreatePath,
  getShiftResultMessage,
  isLatestShiftCalendarRequest,
  loadShiftCalendarData,
} from './views/ShiftCalendarView';
import {
  getActivePreselectedWorkerId,
  getShiftCreateContext,
} from './views/ShiftCreateView';
import type { ControllerResponse } from '../../shared/controllers';

describe('App inventory route helpers', () => {
  it('treats lot-create as an implemented view', () => {
    expect(isImplementedViewNodeId('lot-create')).toBe(true);
  });

  it('treats waste-create as an implemented view', () => {
    expect(isImplementedViewNodeId('waste-create')).toBe(true);
  });

  it('treats product-status as an implemented view', () => {
    expect(isImplementedViewNodeId('product-status')).toBe(true);
  });

  it('treats product-delete as an implemented view', () => {
    expect(isImplementedViewNodeId('product-delete')).toBe(true);
  });

  it('treats audit-log as an implemented view', () => {
    expect(isImplementedViewNodeId('audit-log')).toBe(true);
  });

  it('treats both shift routes as implemented views', () => {
    expect(isImplementedViewNodeId('shift-calendar')).toBe(true);
    expect(isImplementedViewNodeId('shift-create')).toBe(true);
  });

  it('provides and clears documented shift success messages', () => {
    expect(getShiftResultMessage('edit-success')).toBe(
      'Turno actualizado correctamente.',
    );
    expect(getShiftResultMessage('delete-success')).toBe(
      'Turno eliminado correctamente.',
    );
    expect(getShiftResultMessage('start-operation')).toBeNull();
  });

  it('transfers the selected date and optional worker from V16 to V17', () => {
    const path = buildShiftCreatePath('2026-06-15', 2);

    expect(path).toBe(
      '/app/personal/turnos/nuevo?fecha=15%2F06%2F2026&trabajadorId=2',
    );
    expect(getShiftCreateContext(path)).toEqual({
      fecha: '15/06/2026',
      trabajadorId: 2,
    });
    expect(
      getShiftCreateContext(
        '/app/personal/turnos/nuevo?fecha=15%2F06%2F2026',
      ),
    ).toEqual({
      fecha: '15/06/2026',
      trabajadorId: undefined,
    });
  });

  it('ignores invalid or unrelated V17 query parameters', () => {
    expect(
      getShiftCreateContext(
        '/app/personal/turnos/nuevo?fecha=31%2F02%2F2026&trabajadorId=-1&extra=1',
      ),
    ).toEqual({
      fecha: '',
      trabajadorId: undefined,
    });
  });

  it('preselects a worker only while it remains active', () => {
    const activeWorkers = [
      {
        trabajadorId: 2,
        rut: '23456789-0',
        nombreCompleto: 'Camila Rojas',
      },
    ];

    expect(getActivePreselectedWorkerId(activeWorkers, 2)).toBe('2');
    expect(getActivePreselectedWorkerId(activeWorkers, 3)).toBe('');
  });

  it('accepts only the latest calendar response', () => {
    expect(isLatestShiftCalendarRequest(1, 2)).toBe(false);
    expect(isLatestShiftCalendarRequest(2, 2)).toBe(true);
  });

  it('loads workers and shifts together for calendar load and retry', async () => {
    const invoke = vi.fn(
      async (channel: string): Promise<ControllerResponse<unknown>> => {
        if (channel === 'trabajador:listar-activos') {
          return { ok: true, data: [] };
        }

        return {
          ok: true,
          data: {
            inicioSemana: '2026-06-08',
            finSemana: '2026-06-14',
            turnos: [],
          },
        };
      },
    );

    await loadShiftCalendarData(
      invoke as typeof window.appApi.invoke,
      {
        usuarioId: '12345678-9',
        inicioSemana: '2026-06-08',
      },
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'trabajador:listar-activos',
      'turno:listar',
    ]);
  });

  it('fails calendar loading when either required resource is unavailable', async () => {
    const invoke = vi.fn(
      async (channel: string): Promise<ControllerResponse<unknown>> =>
        channel === 'trabajador:listar-activos'
          ? {
              ok: false,
              error: {
                code: 'TECHNICAL_ERROR',
                message: 'No fue posible cargar los trabajadores.',
              },
            }
          : {
              ok: true,
              data: {
                inicioSemana: '2026-06-08',
                finSemana: '2026-06-14',
                turnos: [],
              },
            },
    );

    await expect(
      loadShiftCalendarData(invoke as typeof window.appApi.invoke, {
        usuarioId: '12345678-9',
        inicioSemana: '2026-06-08',
      }),
    ).rejects.toThrow('No fue posible cargar los trabajadores.');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('reads the product status EAN-13 route parameter', () => {
    expect(
      getProductStatusEan13(
        '/app/inventario/productos/7802920000015/estado',
      ),
    ).toBe('7802920000015');
  });

  it('reads the contextual EAN-13 query parameter', () => {
    expect(
      getLotCreateEan13('/app/inventario/lotes/nuevo?ean13=7802920000015'),
    ).toBe('7802920000015');
  });

  it('reads the contextual EAN-13 query parameter for waste registration', () => {
    expect(
      getWasteCreateEan13('/app/inventario/mermas/nueva?ean13=7802920000015'),
    ).toBe('7802920000015');
  });

  it('reads the contextual EAN-13 query parameter for product deletion', () => {
    expect(
      getProductDeleteEan13(
        '/app/inventario/productos/eliminar?ean13=7802920000015',
      ),
    ).toBe('7802920000015');
  });

  it('exposes a neutral fallback without internal traceability', () => {
    expect(VIEW_UNAVAILABLE_TITLE).toBe('Vista no disponible');
    expect(VIEW_UNAVAILABLE_MESSAGE).toBe(
      'La vista solicitada no está disponible.',
    );

    const fallbackText = `${VIEW_UNAVAILABLE_TITLE} ${VIEW_UNAVAILABLE_MESSAGE}`;

    expect(fallbackText).not.toContain('Controladores');
    expect(fallbackText).not.toContain('Componentes internos');
  });
});
