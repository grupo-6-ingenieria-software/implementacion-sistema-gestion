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
import {
  NON_ACTIVITY_CHANNELS,
  refreshSessionActivity,
  verifySessionWithExecutor,
} from './session';
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

/**
 * Modelo de actividad real (RF55): la fuente del último acceso es el dispatcher,
 * que refresca sesion_fecha_hora_ultimo_acceso en cada IPC autenticado SALVO los
 * canales de NON_ACTIVITY_CHANNELS (latido y logout). Estas pruebas reproducen la
 * decisión exacta del dispatcher (index.ts):
 *   if (sesionId && !NON_ACTIVITY_CHANNELS.has(channel)) refreshSessionActivity(...)
 */
describe('actividad de sesión a nivel del dispatcher (RF55)', () => {
  const ULTIMO_ACCESO = '2026-06-13T12:00:00.000Z';
  const ACCION_NOW = new Date('2026-06-13T12:10:00.000Z');

  async function seedSessionAt(ultimoAccesoIso: string): Promise<void> {
    await testDb!.db.run(sql`
      INSERT INTO sesion_usuario (
        sesion_usuario_id, sesion_fecha_hora_inicio,
        sesion_fecha_hora_ultimo_acceso, usuario_id
      ) VALUES (${SESSION_ID}, ${ultimoAccesoIso}, ${ultimoAccesoIso}, '11111111-1')
    `);
  }

  async function readUltimoAcceso(): Promise<string | undefined> {
    const rows = await testDb!.db.all<{ ultimo: string }>(
      sql`SELECT sesion_fecha_hora_ultimo_acceso AS ultimo FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    return rows[0]?.ultimo;
  }

  // Réplica de la decisión del dispatcher: refresca sólo si el canal cuenta como
  // actividad. Devuelve true si refrescó.
  async function dispatchActivity(channel: string): Promise<boolean> {
    const sesionId = SESSION_ID;
    if (sesionId && !NON_ACTIVITY_CHANNELS.has(channel)) {
      await refreshSessionActivity(testDb!.db, schema, sesionId, {
        now: () => ACCION_NOW,
      });
      return true;
    }
    return false;
  }

  it('(a) the heartbeat alone never resets inactivity', async () => {
    await seedSessionAt(ULTIMO_ACCESO);

    // Varios latidos seguidos: el dispatcher NO refresca y el verify es de sólo
    // lectura. El último acceso no se mueve.
    for (let i = 0; i < 3; i += 1) {
      expect(await dispatchActivity('auth:verificar-sesion')).toBe(false);
      await verifySessionWithExecutor(testDb!.db, schema, SESSION_ID, {
        now: () => new Date('2026-06-13T12:05:00.000Z'),
      });
    }

    expect(await readUltimoAcceso()).toBe(ULTIMO_ACCESO);
  });

  it('(b) an action IPC through the dispatcher refreshes ultimo_acceso', async () => {
    await seedSessionAt(ULTIMO_ACCESO);

    const refreshed = await dispatchActivity('venta:registrar');

    expect(refreshed).toBe(true);
    expect(await readUltimoAcceso()).toBe(ACCION_NOW.toISOString());
  });

  it('(c) auth:verificar-sesion and auth:logout do NOT refresh ultimo_acceso', async () => {
    await seedSessionAt(ULTIMO_ACCESO);

    expect(NON_ACTIVITY_CHANNELS.has('auth:verificar-sesion')).toBe(true);
    expect(NON_ACTIVITY_CHANNELS.has('auth:logout')).toBe(true);

    expect(await dispatchActivity('auth:verificar-sesion')).toBe(false);
    expect(await dispatchActivity('auth:logout')).toBe(false);

    // Ninguno de los dos canales tocó el último acceso.
    expect(await readUltimoAcceso()).toBe(ULTIMO_ACCESO);
  });
});
