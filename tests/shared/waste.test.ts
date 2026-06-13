import { describe, expect, it } from 'vitest';
import {
  hasWasteFieldErrors,
  normalizeWasteRegisterPayload,
  validateWasteRegisterPayload,
} from '../../src/shared/waste';

describe('waste helpers', () => {
  it('normalizes waste registration payloads', () => {
    expect(
      normalizeWasteRegisterPayload({
        ean13: ' 7802920000015 ',
        cantidad: '4.9',
        motivo: ' dano ',
        observacion: '  Envase quebrado  ',
        usuarioId: ' 12345678-9 ',
      }),
    ).toEqual({
      ean13: '7802920000015',
      cantidad: 4,
      motivo: 'dano',
      observacion: 'Envase quebrado',
      usuarioId: '12345678-9',
    });
  });

  it('drops blank observations and invalid reasons during normalization', () => {
    expect(
      normalizeWasteRegisterPayload({
        ean13: '7802920000015',
        cantidad: 1,
        motivo: 'perdida',
        observacion: '   ',
      }),
    ).toMatchObject({
      motivo: '',
      observacion: undefined,
    });
  });

  it('validates required fields and stock bounds', () => {
    const errors = validateWasteRegisterPayload(
      {
        ean13: '780292',
        cantidad: 7,
        motivo: '',
        usuarioId: '',
      },
      { requireUser: true, stockDisponible: 3 },
    );

    expect(errors).toMatchObject({
      ean13: expect.any(String),
      cantidad: expect.stringContaining('stock disponible'),
      motivo: expect.any(String),
      usuarioId: expect.any(String),
    });
    expect(hasWasteFieldErrors(errors)).toBe(true);
  });

  it('accepts a valid payload with optional observation omitted', () => {
    expect(
      validateWasteRegisterPayload(
        {
          ean13: '7802920000015',
          cantidad: 2,
          motivo: 'error_registro',
          usuarioId: '12345678-9',
        },
        { requireUser: true, stockDisponible: 2 },
      ),
    ).toEqual({});
  });
});
