import { describe, expect, it } from 'vitest';
import { defaultAuditLogPageSize } from '../../../shared/audit';
import {
  buildAuditLogQueryPayload,
  formatDateTime,
  type AuditLogFilters,
} from './AuditLogView';

describe('AuditLogView helpers', () => {
  it('builds a compact query payload from visible filters', () => {
    const filters: AuditLogFilters = {
      fechaDesde: '2026-06-01',
      fechaHasta: '',
      tipoAccion: 'registro',
      usuarioFiltroId: '',
    };

    expect(buildAuditLogQueryPayload('12345678-9', filters, 2)).toEqual({
      fechaDesde: '2026-06-01',
      fechaHasta: undefined,
      page: 2,
      pageSize: defaultAuditLogPageSize,
      tipoAccion: 'registro',
      usuarioFiltroId: undefined,
      usuarioId: '12345678-9',
    });
  });

  it('formats audit timestamps without throwing during table render', () => {
    expect(() => formatDateTime('2026-06-13T00:58:41.932Z')).not.toThrow();
    expect(formatDateTime('fecha sin formato')).toBe('fecha sin formato');
  });
});
