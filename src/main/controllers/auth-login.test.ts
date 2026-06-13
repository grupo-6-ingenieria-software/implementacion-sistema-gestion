import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { authenticateWithExecutor, type LoginDeps } from './auth-login';
import {
  createAuthTestDatabase,
  insertLoginAttempt,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from './auth-fixtures';

const NOW = new Date('2026-06-13T12:00:00.000Z');

function makeDeps(matches: boolean): LoginDeps {
  return {
    comparePassword: async (plain: string) =>
      matches && plain === 'good',
    signToken: () => 'jwt-token',
    now: () => NOW,
  };
}

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
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

describe('authenticateWithExecutor (CU56)', () => {
  it('rejects missing credentials with a validation error', async () => {
    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '', contrasena: '' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('authenticates a valid owner and creates a session, attempt and audit log', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
      rolBd: 'dueno',
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.token).toBe('jwt-token');
      expect(response.data.role).toBe('dueno');
      expect(response.data.passwordChangeRequired).toBe(false);
    }

    const counts = await testDb!.db.all<{
      sesiones: number;
      exitosos: number;
      auditorias: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM sesion_usuario) AS sesiones,
        (SELECT COUNT(*) FROM intento_login WHERE intento_exitoso = 1) AS exitosos,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias
    `);

    expect(counts[0]).toMatchObject({ sesiones: 1, exitosos: 1, auditorias: 1 });
  });

  it('returns the generic error and records a failed attempt on wrong password (e1)', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'bad' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message).toBe('Usuario o contraseña incorrectos');
    }

    const failed = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM intento_login WHERE intento_exitoso = 0`,
    );
    expect(Number(failed[0]?.total)).toBe(1);
  });

  it('returns the generic error for an unknown user (e1)', async () => {
    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: 'no-existe', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message).toBe('Usuario o contraseña incorrectos');
    }
  });

  it('blocks the 5th consecutive failure (e1b)', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
    });

    for (let index = 0; index < 4; index += 1) {
      await insertLoginAttempt(testDb!.db, {
        usuario: '12345678-9',
        exitoso: false,
        fechaHora: minutesAgo(4 - index),
        usuarioId: '12345678-9',
      });
    }

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'bad' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('FORBIDDEN');
      expect(response.error.message).toContain('bloqueada');
    }
  });

  it('rejects login while the account is already locked (e2)', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
    });

    for (let index = 0; index < 5; index += 1) {
      await insertLoginAttempt(testDb!.db, {
        usuario: '12345678-9',
        exitoso: false,
        fechaHora: minutesAgo(5 - index),
        usuarioId: '12345678-9',
      });
    }

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('FORBIDDEN');
      expect(response.error.message).toContain('bloqueada');
    }
  });

  it('rejects an inactive worker account (e3)', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
      estado: 'inactivo',
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('FORBIDDEN');
      expect(response.error.message).toContain('inactiva');
    }
  });

  it('forces a password change for a valid temporal password', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
      esTemporal: true,
      temporalExpiracion: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.passwordChangeRequired).toBe(true);
    }
  });

  it('rejects an expired temporal password (RF58)', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
      esTemporal: true,
      temporalExpiracion: new Date(NOW.getTime() - 3_600_000).toISOString(),
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '12345678-9', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('BUSINESS_RULE');
    }
  });

  it('matches the stored RUT ignoring the dash (digit-only input)', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: '123456789', contrasena: 'good' },
      makeDeps(true),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.usuarioId).toBe('12345678-9');
    }
  });
});
