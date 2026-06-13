import { describe, expect, it } from 'vitest';
import {
  filterAndSortUserList,
  formatRoleLabel,
  formatRutInput,
  hasUserFieldErrors,
  normalizeRut,
  normalizeUserFormPayload,
  normalizeUserListPayload,
  normalizeUserRole,
  validateUserFormValues,
  type UserListItem,
} from '../../src/shared/users';

describe('formatRutInput', () => {
  it('inserts the dash before the verifier digit automatically', () => {
    expect(formatRutInput('226024395')).toBe('22602439-5');
  });

  it('ignores a dash typed by the user and re-inserts it', () => {
    expect(formatRutInput('22602439-5')).toBe('22602439-5');
    expect(formatRutInput('2-2-6')).toBe('22-6');
  });

  it('moves the dash dynamically as more digits are typed', () => {
    expect(formatRutInput('1')).toBe('1');
    expect(formatRutInput('12')).toBe('1-2');
    expect(formatRutInput('123')).toBe('12-3');
  });

  it('keeps a K verifier and uppercases it', () => {
    expect(formatRutInput('12345670k')).toBe('12345670-K');
  });

  it('drops dots, spaces and other characters', () => {
    expect(formatRutInput('22.602.439-5')).toBe('22602439-5');
  });
});

const users: UserListItem[] = [
  {
    usuarioId: '12345678-9',
    rut: '12345678-9',
    nombreCompleto: 'Maria Huascar',
    rol: 'dueno',
    telefono: '987654321',
    correoElectronico: 'maria@huascar.cl',
    fechaIngreso: '2024-01-01',
    estado: 'activo',
  },
  {
    usuarioId: '23456789-0',
    rut: '23456789-0',
    nombreCompleto: 'Camila Rojas',
    rol: 'trabajador',
    telefono: '912345678',
    fechaIngreso: '2025-06-15',
    estado: 'activo',
  },
  {
    usuarioId: '34567890-1',
    rut: '34567890-1',
    nombreCompleto: 'Luis Soto',
    rol: 'trabajador',
    telefono: '923456789',
    correoElectronico: 'luis@huascar.cl',
    fechaIngreso: '2023-03-10',
    estado: 'inactivo',
  },
];

describe('user list helpers', () => {
  it('normalizes legacy roles into the two-role model', () => {
    expect(normalizeUserRole('dueño')).toBe('dueno');
    expect(normalizeUserRole('dueÃ±o')).toBe('dueno');
    expect(normalizeUserRole('cajero')).toBe('trabajador');
    expect(normalizeUserRole('reponedor')).toBe('trabajador');
    expect(formatRoleLabel('dueno')).toBe('Dueño');
  });

  it('filters by search, role and status', () => {
    const filters = normalizeUserListPayload({
      search: 'rojas',
      rol: 'trabajador',
      estado: 'activo',
    });

    expect(filterAndSortUserList(users, filters).map((user) => user.usuarioId))
      .toEqual(['23456789-0']);
  });

  it('sorts users by admission date descending', () => {
    const filters = normalizeUserListPayload({
      sortBy: 'fechaIngreso',
      sortDirection: 'desc',
    });

    expect(filterAndSortUserList(users, filters).map((user) => user.usuarioId))
      .toEqual(['23456789-0', '12345678-9', '34567890-1']);
  });

  it('normalizes and validates RF21 worker account form values', () => {
    const payload = normalizeUserFormPayload({
      correoElectronico: ' ana@huascar.cl ',
      nombreCompleto: ' Ana   Soto ',
      rol: 'trabajador',
      rut: '12.345.678-5',
      telefono: '987 654 321',
    });

    expect(payload).toEqual({
      correoElectronico: 'ana@huascar.cl',
      nombreCompleto: 'Ana Soto',
      rol: 'trabajador',
      rut: '12345678-5',
      telefono: '987654321',
      usuarioId: undefined,
    });
    expect(normalizeRut('12.345.678-k')).toBe('12345678-K');
  });

  it('returns field errors for invalid RF21 values', () => {
    const errors = validateUserFormValues({
      correoElectronico: 'correo-invalido',
      nombreCompleto: '',
      rol: 'trabajador',
      rut: '123',
      telefono: '123',
    });

    expect(hasUserFieldErrors(errors)).toBe(true);
    expect(errors.rut).toBeDefined();
    expect(errors.nombreCompleto).toBeDefined();
    expect(errors.telefono).toBeDefined();
    expect(errors.correoElectronico).toBeDefined();
  });

  it('allows legacy non-editable RUT values during RF22 updates', () => {
    const errors = validateUserFormValues(
      {
        nombreCompleto: 'Maria Huascar',
        rol: 'dueno',
        rut: '12345678-9',
        telefono: '987654321',
      },
      { validateRutFormat: false },
    );

    expect(hasUserFieldErrors(errors)).toBe(false);
  });
});
