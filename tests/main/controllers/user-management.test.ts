import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '../../../src/shared/navigation';
import type {
  UserListItem,
  UserListResponse,
  UserPasswordResetRequestResponse,
} from '../../../src/shared/users';
import * as schema from '../../../src/db/schema';
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from '../../../src/main/controllers/auth-context';
import {
  resetPasswordWithExecutor,
  type PasswordDeps,
} from '../../../src/main/controllers/password';
import { createUserManagementController } from '../../../src/main/controllers/user-management';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from '../../../src/main/controllers/auth-fixtures';

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
      ok: true,
      data: {
        estado: 'completado',
        contrasenaTemporal: 'TmpPass1',
        usuarioObjetivoId: payload.usuarioObjetivoId,
      },
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

  it('generates a temporary password through the auth reset generator', async () => {
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

    const data = response.data as UserPasswordResetRequestResponse;
    expect(data.estado).toBe('completado');
    expect(data.contrasenaTemporal).toBe('TmpPass1');
    expect(data.usuarioObjetivoId).toBe('23456789-0');
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

describe('user management password reset wiring (RF58)', () => {
  const NOW = new Date('2026-06-13T12:00:00.000Z');
  const deps: PasswordDeps = {
    hashPassword: async (plain: string) => `hash:${plain}`,
    comparePassword: async () => false,
    generateTempPassword: () => 'TmpPass1',
    now: () => NOW,
  };

  let testDb: AuthTestDatabase | undefined;

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
    await seedUser(testDb.db, {
      usuarioId: '11111111-1',
      trabajadorId: 1,
      rut: '11111111-1',
      rolBd: 'dueno',
    });
    await seedUser(testDb.db, {
      usuarioId: '22222222-2',
      trabajadorId: 2,
      rut: '22222222-2',
      rolBd: 'trabajador',
      nombre: 'Camila',
      apellido: 'Rojas',
    });
  });

  afterEach(async () => {
    if (!testDb) {
      return;
    }

    testDb.client.close();
    await removeAuthTempDir(testDb.dir);
    testDb = undefined;
  });

  function createDbBackedController() {
    return createUserManagementController({
      authorize: async () => {
        throw new Error('authorize should not be used for the reset channel');
      },
      listUsers: async () => [],
      requestPasswordReset: async (payload) =>
        resetPasswordWithExecutor(
          testDb!.db,
          schema,
          {
            usuarioId: payload.usuarioId,
            usuarioObjetivoId: payload.usuarioObjetivoId,
          },
          deps,
        ).then((result) =>
          result.ok
            ? {
                ok: true as const,
                data: {
                  estado: 'completado' as const,
                  contrasenaTemporal: result.data.contrasenaTemporal,
                  usuarioObjetivoId: result.data.usuarioObjetivoId,
                },
              }
            : result,
        ),
    });
  }

  it('lets a dueno requester create a 24h temporary password row', async () => {
    const response = await createDbBackedController().handle(
      { usuarioId: '11111111-1', usuarioObjetivoId: '22222222-2' },
      { channel: 'usuario:solicitar-restablecimiento' },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    const data = response.data as UserPasswordResetRequestResponse;
    expect(data.estado).toBe('completado');
    expect(data.contrasenaTemporal).toBe('TmpPass1');

    const rows = await testDb!.db.all<{
      temporales: number;
      expiraciones: number;
      expiracion: string | null;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM contrasena WHERE usuario_id = '22222222-2' AND es_contrasena_temporal = 1) AS temporales,
        (SELECT COUNT(*) FROM contrasena_temporal) AS expiraciones,
        (SELECT contrasena_temporal_fecha_hora_expiracion FROM contrasena_temporal LIMIT 1) AS expiracion
    `);

    expect(rows[0].temporales).toBe(1);
    expect(rows[0].expiraciones).toBe(1);
    // Expiración a 24h del momento de generación.
    expect(rows[0].expiracion).toBe('2026-06-14T12:00:00.000Z');
  });

  it('rejects a non-dueno requester', async () => {
    const response = await createDbBackedController().handle(
      { usuarioId: '22222222-2', usuarioObjetivoId: '11111111-1' },
      { channel: 'usuario:solicitar-restablecimiento' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden password reset');
    }

    expect(response.error.code).toBe('FORBIDDEN');
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
