import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import {
  validateAccessWithExecutor,
  type AccessControlDeps,
} from './access-control';
import type { SessionTokenClaims } from './auth-jwt';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from './auth-fixtures';

function claimsFor(rol: 'dueno' | 'trabajador'): SessionTokenClaims {
  return {
    usuarioId: '12345678-9',
    rol,
    usuarioRol: rol === 'dueno' ? 'dueno' : 'trabajador',
    passwordTemporal: false,
    sesionId: '00000000-0000-4000-8000-000000000777',
  };
}

function depsWith(token: SessionTokenClaims | null): AccessControlDeps {
  return { verifyToken: () => token };
}

let testDb: AuthTestDatabase | undefined;

beforeEach(async () => {
  testDb = await createAuthTestDatabase();
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeAuthTempDir(testDb.dir);
  testDb = undefined;
});

describe('validateAccessWithExecutor (RF56/CU57)', () => {
  it('forbids access without a valid token', async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: 'bad', ruta: '/app/inicio' },
      depsWith(null),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('FORBIDDEN');
    }
  });

  it('allows a route permitted for the role', async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: 't', ruta: '/app/inicio' },
      depsWith(claimsFor('dueno')),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.allowed).toBe(true);
    }
  });

  it('denies a route not permitted for the role and audits it', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
      rolBd: 'trabajador',
    });

    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: 't', ruta: '/app/personal/trabajadores' },
      depsWith(claimsFor('trabajador')),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('FORBIDDEN');
    }

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_denegado'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });

  it('validates the route is present', async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: 't', ruta: '' },
      depsWith(claimsFor('dueno')),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns not found for an unknown route', async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: 't', ruta: '/app/no-existe' },
      depsWith(claimsFor('dueno')),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('NOT_FOUND');
    }
  });
});
