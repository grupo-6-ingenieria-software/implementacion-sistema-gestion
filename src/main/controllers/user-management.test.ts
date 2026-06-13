import { describe, expect, it } from 'vitest';
import type { Role } from '../../shared/navigation';
import type {
  UserListItem,
  UserListResponse,
  UserPasswordResetRequestResponse,
} from '../../shared/users';
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from './auth-context';
import { createUserManagementController } from './user-management';

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
];

function createController() {
  return createUserManagementController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    listUsers: async () => users,
    requestPasswordReset: async (payload) => ({
      estado: 'pendiente-auth',
      mensaje: 'pendiente',
      usuarioObjetivoId: payload.usuarioObjetivoId,
    }),
  });
}

describe('user management controller', () => {
  it('lists users for owner sessions', async () => {
    const response = await createController().handle(
      { usuarioId: 'dueno' },
      { channel: 'usuario:listar' },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect((response.data as UserListResponse).users).toHaveLength(2);
  });

  it('rejects worker sessions', async () => {
    const response = await createController().handle(
      { usuarioId: 'trabajador' },
      { channel: 'usuario:listar' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden user list');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });

  it('applies user list filters', async () => {
    const response = await createController().handle(
      {
        usuarioId: 'dueno',
        search: 'rojas',
        rol: 'trabajador',
        estado: 'activo',
      },
      { channel: 'usuario:listar' },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    const data = response.data as UserListResponse;

    expect(data.users.map((user) => user.usuarioId)).toEqual([
      '23456789-0',
    ]);
  });

  it('prepares password reset without implementing auth password generation', async () => {
    const response = await createController().handle(
      {
        usuarioId: 'dueno',
        usuarioObjetivoId: '23456789-0',
      },
      { channel: 'usuario:solicitar-restablecimiento' },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect((response.data as UserPasswordResetRequestResponse).estado).toBe(
      'pendiente-auth',
    );
  });

  it('does not expose worker creation through the user module', async () => {
    const response = await createController().handle(
      { usuarioId: 'dueno' },
      { channel: 'usuario:crear-trabajador' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected invalid channel');
    }

    expect(response.error.code).toBe('INVALID_CHANNEL');
  });
});

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role = usuarioId === 'dueno' ? 'dueno' : usuarioId === 'trabajador' ? 'trabajador' : null;

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? '',
    usuarioRol: role,
    trabajadorNombre: role === 'dueno' ? 'Dueno Prueba' : 'Trabajador Prueba',
  };
}
