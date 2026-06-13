import { describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  displayDateToIso,
  getWeekStartForDateKey,
  parseShiftRange,
  validateShiftCreatePayload,
  validateShiftDeletePayload,
  validateShiftEditPayload,
  validateShiftListPayload,
} from '../../src/shared/shifts';

describe('shift contracts', () => {
  it('validates documented date and time formats', () => {
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha: '13/06/2026',
        horaInicio: '09:00',
        horaTermino: '08:00',
      }),
    ).toMatchObject({
      horaTermino:
        'La hora de termino debe ser posterior a la hora de inicio.',
    });
    expect(displayDateToIso('31/02/2026')).toBeNull();
    expect(displayDateToIso('13/06/2026')).toBe('2026-06-13');
  });

  it('rejects invalid times and shifts that cross midnight', () => {
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha: '13/06/2026',
        horaInicio: '8:00',
        horaTermino: '16:60',
      }),
    ).toMatchObject({
      horaInicio: 'Ingrese la hora de inicio en formato HH:MM.',
      horaTermino: 'Ingrese la hora de termino en formato HH:MM.',
    });
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha: '13/06/2026',
        horaInicio: '22:00',
        horaTermino: '02:00',
      }),
    ).toMatchObject({
      horaTermino:
        'La hora de termino debe ser posterior a la hora de inicio.',
    });
  });

  it('requires a shift id and confirmation before deletion', () => {
    expect(
      validateShiftDeletePayload({
        turnoId: '',
        confirmacion: false,
      }),
    ).toEqual({
      turnoId: 'No se pudo identificar el turno.',
      confirmacion: 'Debe confirmar la eliminacion del turno.',
    });
  });

  it('applies the same date and time validation when editing', () => {
    expect(
      validateShiftEditPayload({
        turnoId: 'turno-1',
        fecha: '31/02/2026',
        horaInicio: '10:00',
        horaTermino: '09:00',
      }),
    ).toMatchObject({
      fecha: 'Ingrese la fecha en formato DD/MM/AAAA.',
      horaTermino:
        'La hora de termino debe ser posterior a la hora de inicio.',
    });
  });

  it.each([
    '13/13/2026',
    '00/01/2026',
    '31/02/2026',
    '01/00/2026',
  ])('rejects impossible display date %s without throwing', (fecha) => {
    expect(() => displayDateToIso(fecha)).not.toThrow();
    expect(displayDateToIso(fecha)).toBeNull();
    expect(
      validateShiftCreatePayload({
        trabajadorId: 1,
        fecha,
        horaInicio: '08:00',
        horaTermino: '16:00',
      }),
    ).toMatchObject({
      fecha: 'Ingrese la fecha en formato DD/MM/AAAA.',
    });
  });

  it.each([
    '2026-13-01',
    '2026-00-01',
    '2026-02-31',
  ])('rejects impossible ISO date %s without throwing', (inicioSemana) => {
    expect(() =>
      validateShiftListPayload({
        inicioSemana,
      }),
    ).not.toThrow();
    expect(
      validateShiftListPayload({
        inicioSemana,
      }),
    ).toMatchObject({
      fecha: 'Ingrese un inicio de semana valido.',
    });
  });

  it('converts Chile local hours to UTC timestamps', () => {
    expect(
      parseShiftRange({
        fecha: '13/06/2026',
        horaInicio: '08:00',
        horaTermino: '16:00',
      }),
    ).toEqual({
      fechaIso: '2026-06-13',
      inicioAt: '2026-06-13T12:00:00.000Z',
      terminoAt: '2026-06-13T20:00:00.000Z',
    });
  });

  it('calculates Monday-based weeks', () => {
    expect(getWeekStartForDateKey('2026-06-13')).toBe('2026-06-08');
    expect(getWeekStartForDateKey('2026-06-14')).toBe('2026-06-08');
    expect(addDaysToDateKey('2026-06-08', 6)).toBe('2026-06-14');
  });
});
