import { describe, expect, it } from 'vitest';
import {
  normalizeWorkerFormValues,
  roleLabel,
  validateWorkerFormValues,
} from '../../src/shared/workers';

describe('worker form contract', () => {
  it('normalizes the fields required to register a worker', () => {
    expect(
      normalizeWorkerFormValues({
        rut: '12.345.678-9',
        nombreCompleto: '  Camila   Rojas  ',
        rol: 'trabajador',
        telefono: '912 345 678',
        correo: ' camila@huascar.cl ',
      }),
    ).toEqual({
      rut: '12345678-9',
      nombreCompleto: 'Camila Rojas',
      rol: 'trabajador',
      telefono: '912345678',
      correo: 'camila@huascar.cl',
    });
  });

  it('reports the RF21 field errors before saving', () => {
    expect(
      validateWorkerFormValues({
        rut: '123',
        nombreCompleto: '',
        rol: 'trabajador',
        telefono: '123',
        correo: 'correo-invalido',
      }),
    ).toEqual({
      rut: 'Ingrese un RUT valido.',
      nombreCompleto: 'Ingrese el nombre completo.',
      telefono: 'Ingrese un telefono de 9 digitos.',
      correo: 'Ingrese un correo valido.',
    });
  });

  it('uses system role labels for the worker list and form', () => {
    expect(roleLabel('dueno')).toBe('Dueno');
    expect(roleLabel('trabajador')).toBe('Trabajador');
  });
});
