/**
 * Regresión RF55: el latido (heartbeat) del renderer atraviesa el guard del
 * dispatcher y luego el controlador de sesión. El renderer adjunta el JWT como
 * `__authToken` (no como `token`). Esta prueba reproduce ese flujo de extremo a
 * extremo para garantizar que una sesión recién creada se reporte activa y no se
 * cierre prematuramente (antes el verify re-leía payload.token → siempre inactivo
 * → cierre forzado a los ~60 s).
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { guardChannel } from './auth-guard';
import { verifySessionWithExecutor } from './session';
import { signSessionToken } from './auth-jwt';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from './auth-fixtures';

const SESSION_ID = '123e4567-e89b-42d3-a456-556642440000';

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

async function seedOpenSession(): Promise<void> {
  const now = new Date().toISOString();
  await testDb!.db.run(sql`
    INSERT INTO sesion_usuario (
      sesion_usuario_id, sesion_fecha_hora_inicio,
      sesion_fecha_hora_ultimo_acceso, usuario_id
    ) VALUES (${SESSION_ID}, ${now}, ${now}, '11111111-1')
  `);
}

function heartbeatPayload(): Record<string, unknown> {
  // Forma exacta que arma el preload: el token viaja en __authToken.
  const token = signSessionToken({
    usuarioId: '11111111-1',
    rol: 'dueno',
    usuarioRol: 'dueno',
    passwordTemporal: false,
    sesionId: SESSION_ID,
  });

  return { __authToken: token };
}

describe('heartbeat end-to-end (preload → guard → session)', () => {
  it('reports a fresh session as active', async () => {
    await seedOpenSession();

    const guard = await guardChannel('auth:verificar-sesion', heartbeatPayload());
    expect(guard.ok).toBe(true);
    if (!guard.ok) {
      return;
    }

    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      guard.context.claims?.sesionId,
      { now: () => new Date() },
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.active).toBe(true);
    }
  });

  it('rejects a heartbeat without a token before reaching the controller', async () => {
    const guard = await guardChannel('auth:verificar-sesion', { __authToken: null });

    // El guard corta los canales autenticados sin token válido: el renderer ve
    // !response.ok y cierra la sesión, como corresponde.
    expect(guard.ok).toBe(false);
  });
});
