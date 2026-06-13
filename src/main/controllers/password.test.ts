import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import {
  changePasswordWithExecutor,
  resetPasswordWithExecutor,
  type PasswordDeps,
} from './password';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from './auth-fixtures';

const NOW = new Date('2026-06-13T12:00:00.000Z');
const CURRENT = 'Current123';

const deps: PasswordDeps = {
  hashPassword: async (plain: string) => `hash:${plain}`,
  comparePassword: async (plain: string) => plain === CURRENT,
  generateTempPassword: () => 'TmpPass1',
  now: () => NOW,
};

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

describe('changePasswordWithExecutor (CU56b)', () => {
  beforeEach(async () => {
    await seedUser(testDb!.db, {
      usuarioId: '12345678-9',
      trabajadorId: 1,
      rut: '12345678-9',
      rolBd: 'dueno',
    });
  });

  it('stores a new definitive password and audits the change', async () => {
    const response = await changePasswordWithExecutor(
      testDb!.db,
      schema,
      {
        usuarioId: '12345678-9',
        contrasenaActual: CURRENT,
        contrasenaNueva: 'NuevaClave9',
      },
      deps,
    );

    expect(response.ok).toBe(true);

    const counts = await testDb!.db.all<{
      contrasenas: number;
      definitivas: number;
      auditorias: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM contrasena) AS contrasenas,
        (SELECT COUNT(*) FROM contrasena WHERE es_contrasena_definitiva = 1) AS definitivas,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias
    `);

    expect(counts[0]).toMatchObject({
      contrasenas: 2,
      definitivas: 2,
      auditorias: 1,
    });
  });

  it('changes a temporary password without requiring the current one', async () => {
    await seedUser(testDb!.db, {
      usuarioId: '33333333-3',
      trabajadorId: 3,
      rut: '33333333-3',
      rolBd: 'trabajador',
      esTemporal: true,
    });

    const response = await changePasswordWithExecutor(
      testDb!.db,
      schema,
      {
        usuarioId: '33333333-3',
        contrasenaNueva: 'NuevaClave9',
      },
      deps,
    );

    expect(response.ok).toBe(true);

    const counts = await testDb!.db.all<{
      definitivas: number;
    }>(sql`
      SELECT COUNT(*) AS definitivas
      FROM contrasena
      WHERE usuario_id = '33333333-3' AND es_contrasena_definitiva = 1
    `);

    expect(counts[0].definitivas).toBe(1);
  });

  it('still requires the current password for voluntary changes', async () => {
    const response = await changePasswordWithExecutor(
      testDb!.db,
      schema,
      {
        usuarioId: '12345678-9',
        contrasenaNueva: 'NuevaClave9',
      },
      deps,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('VALIDATION_ERROR');
      expect(response.error.message).toContain('actual');
    }
  });

  it('rejects a wrong current password', async () => {
    const response = await changePasswordWithExecutor(
      testDb!.db,
      schema,
      {
        usuarioId: '12345678-9',
        contrasenaActual: 'Incorrecta9',
        contrasenaNueva: 'NuevaClave9',
      },
      deps,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('VALIDATION_ERROR');
      expect(response.error.message).toContain('actual');
    }
  });

  it('rejects a new password that does not meet complexity', async () => {
    const response = await changePasswordWithExecutor(
      testDb!.db,
      schema,
      {
        usuarioId: '12345678-9',
        contrasenaActual: CURRENT,
        contrasenaNueva: 'debil',
      },
      deps,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a new password equal to the current one', async () => {
    const response = await changePasswordWithExecutor(
      testDb!.db,
      schema,
      {
        usuarioId: '12345678-9',
        contrasenaActual: CURRENT,
        contrasenaNueva: CURRENT,
      },
      deps,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('BUSINESS_RULE');
    }
  });
});

describe('resetPasswordWithExecutor (RF58)', () => {
  beforeEach(async () => {
    await seedUser(testDb!.db, {
      usuarioId: '11111111-1',
      trabajadorId: 1,
      rut: '11111111-1',
      rolBd: 'dueno',
    });
    await seedUser(testDb!.db, {
      usuarioId: '22222222-2',
      trabajadorId: 2,
      rut: '22222222-2',
      rolBd: 'trabajador',
      nombre: 'Camila',
      apellido: 'Rojas',
    });
  });

  it('lets the owner generate a temporal password with 24h expiry', async () => {
    const response = await resetPasswordWithExecutor(
      testDb!.db,
      schema,
      { usuarioId: '11111111-1', usuarioObjetivoId: '22222222-2' },
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.contrasenaTemporal).toBe('TmpPass1');
    }

    const counts = await testDb!.db.all<{
      temporales: number;
      expiraciones: number;
      auditorias: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM contrasena WHERE usuario_id = '22222222-2' AND es_contrasena_temporal = 1) AS temporales,
        (SELECT COUNT(*) FROM contrasena_temporal) AS expiraciones,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias
    `);

    expect(counts[0]).toMatchObject({
      temporales: 1,
      expiraciones: 1,
      auditorias: 1,
    });
  });

  it('forbids a non-owner from resetting passwords', async () => {
    const response = await resetPasswordWithExecutor(
      testDb!.db,
      schema,
      { usuarioId: '22222222-2', usuarioObjetivoId: '11111111-1' },
      deps,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns not found for an unknown target user', async () => {
    const response = await resetPasswordWithExecutor(
      testDb!.db,
      schema,
      { usuarioId: '11111111-1', usuarioObjetivoId: '99999999-9' },
      deps,
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('NOT_FOUND');
    }
  });
});
