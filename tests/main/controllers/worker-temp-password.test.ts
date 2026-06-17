import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../src/db/schema';
import type { PasswordDeps } from '../../../src/main/controllers/password';
import { createWorkerWithExecutor } from '../../../src/main/controllers/worker';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from '../../../src/main/controllers/auth-fixtures';

const NOW = new Date('2026-06-13T12:00:00.000Z');

const passwordDeps: PasswordDeps = {
  hashPassword: async (plain: string) => `hash:${plain}`,
  comparePassword: async () => false,
  generateTempPassword: () => 'TmpWork1',
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
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeAuthTempDir(testDb.dir);
  testDb = undefined;
});

describe('createWorkerWithExecutor (alta de trabajador)', () => {
  it('generates a 24h temporary password and returns it once', async () => {
    const response = await createWorkerWithExecutor(
      testDb!.db,
      schema,
      {
        nombreCompleto: 'Ana Soto',
        rol: 'trabajador',
        rut: '22222222-2',
        telefono: '987654321',
        usuarioId: '11111111-1',
      },
      passwordDeps,
    );

    expect(response.usuarioId).toBe('22222222-2');
    expect(response.contrasenaTemporal).toBe('TmpWork1');

    const counts = await testDb!.db.all<{
      temporales: number;
      expiraciones: number;
      registros: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM contrasena WHERE usuario_id = '22222222-2' AND es_contrasena_temporal = 1) AS temporales,
        (SELECT COUNT(*) FROM contrasena_temporal) AS expiraciones,
        (SELECT COUNT(*) FROM log_auditoria WHERE log_tipo_accion = 'registro') AS registros
    `);

    expect(counts[0]).toMatchObject({
      temporales: 1,
      expiraciones: 1,
      registros: 1,
    });

    const expiry = await testDb!.db.all<{
      contrasena_temporal_fecha_hora_expiracion: string;
    }>(sql`
      SELECT contrasena_temporal_fecha_hora_expiracion FROM contrasena_temporal LIMIT 1
    `);

    // 24h después del NOW fijado en los deps.
    expect(expiry[0].contrasena_temporal_fecha_hora_expiracion).toBe(
      '2026-06-14T12:00:00.000Z',
    );
  });

  it('rolls back the whole alta when the RUT is already registered', async () => {
    await createWorkerWithExecutor(
      testDb!.db,
      schema,
      {
        nombreCompleto: 'Ana Soto',
        rol: 'trabajador',
        rut: '22222222-2',
        telefono: '987654321',
        usuarioId: '11111111-1',
      },
      passwordDeps,
    );

    await expect(
      createWorkerWithExecutor(
        testDb!.db,
        schema,
        {
          nombreCompleto: 'Ana Soto Duplicada',
          rol: 'trabajador',
          rut: '22222222-2',
          telefono: '987654321',
          usuarioId: '11111111-1',
        },
        passwordDeps,
      ),
    ).rejects.toThrow();

    const counts = await testDb!.db.all<{ temporales: number }>(sql`
      SELECT COUNT(*) AS temporales
      FROM contrasena WHERE usuario_id = '22222222-2' AND es_contrasena_temporal = 1
    `);

    // El segundo intento falla antes de insertar; sigue habiendo una sola temporal.
    expect(counts[0].temporales).toBe(1);
  });
});
