import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import {
  closeSessionWithExecutor,
  refreshSessionActivity,
  verifySessionWithExecutor,
  type SessionDeps,
} from './session';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from './auth-fixtures';

const NOW = new Date('2026-06-13T12:00:00.000Z');
const SESSION_ID = '00000000-0000-4000-8000-000000000777';

const deps: SessionDeps = { now: () => NOW };

let testDb: AuthTestDatabase | undefined;

beforeEach(async () => {
  testDb = await createAuthTestDatabase();
  await seedUser(testDb.db, {
    usuarioId: '12345678-9',
    trabajadorId: 1,
    rut: '12345678-9',
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

async function seedSession(ultimoAccesoMinutesAgo: number): Promise<void> {
  const ultimoAcceso = new Date(
    NOW.getTime() - ultimoAccesoMinutesAgo * 60_000,
  ).toISOString();

  await testDb!.db.insert(schema.sesionUsuario).values({
    sesionUsuarioId: SESSION_ID,
    sesionFechaHoraInicio: ultimoAcceso,
    sesionFechaHoraUltimoAcceso: ultimoAcceso,
    usuarioId: '12345678-9',
  });
}

describe('verifySessionWithExecutor (RF55)', () => {
  it('reports a missing sesionId (no trusted claims) as inactive', async () => {
    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      undefined,
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual({ active: false, reason: 'token-invalido' });
    }
  });

  it('reports a missing session as inactive', async () => {
    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      SESSION_ID,
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.reason).toBe('sesion-inexistente');
    }
  });

  it('keeps an active session WITHOUT refreshing the last access time (read-only heartbeat)', async () => {
    // El latido (auth:verificar-sesion) es de sólo lectura: confirma vigencia
    // pero NO reinicia el contador de inactividad. Así la inactividad se acumula
    // mientras el usuario no realice ninguna acción real.
    await seedSession(5);
    const ultimoAccesoOriginal = new Date(
      NOW.getTime() - 5 * 60_000,
    ).toISOString();

    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      SESSION_ID,
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.active).toBe(true);
    }

    const rows = await testDb!.db.all<{ ultimo: string }>(
      sql`SELECT sesion_fecha_hora_ultimo_acceso AS ultimo FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    // El último acceso NO cambió: el latido no lo refresca.
    expect(rows[0]?.ultimo).toBe(ultimoAccesoOriginal);
    expect(rows[0]?.ultimo).not.toBe(NOW.toISOString());
  });

  it('expires after 30 minutes even if heartbeats keep firing (heartbeat never resets inactivity)', async () => {
    // Sesión con 25 min de inactividad: varios latidos seguidos NO la mantienen
    // viva; al cruzar los 30 min se cierra por inactividad.
    await seedSession(25);

    // Latidos a 27 y 29 min: ninguno refresca el último acceso.
    for (const minutes of [27, 29]) {
      const at = new Date(NOW.getTime() + (minutes - 25) * 60_000);
      const beat = await verifySessionWithExecutor(testDb!.db, schema, SESSION_ID, {
        now: () => at,
      });
      expect(beat.ok && beat.data.active).toBe(true);
    }

    // A los 31 min sin acciones reales, el latido detecta y cierra por inactividad.
    const at31 = new Date(NOW.getTime() + 6 * 60_000);
    const expired = await verifySessionWithExecutor(testDb!.db, schema, SESSION_ID, {
      now: () => at31,
    });

    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(expired.data).toEqual({ active: false, reason: 'inactividad' });
    }
  });

  it('closes a session after 30 minutes of inactivity', async () => {
    await seedSession(31);

    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      SESSION_ID,
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual({ active: false, reason: 'inactividad' });
    }

    const rows = await testDb!.db.all<{ motivo: string | null }>(
      sql`SELECT sesion_motivo_cierre AS motivo FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    expect(rows[0]?.motivo).toBe('inactividad');
  });
});

describe('closeSessionWithExecutor (CU56 logout)', () => {
  it('closes the active session as manual using the sesionId from claims', async () => {
    await seedSession(2);

    const response = await closeSessionWithExecutor(
      testDb!.db,
      schema,
      SESSION_ID,
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual({ closed: true });
    }

    const rows = await testDb!.db.all<{
      motivo: string | null;
      cierre: string | null;
    }>(
      sql`SELECT sesion_motivo_cierre AS motivo, sesion_fecha_hora_cierre AS cierre FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    expect(rows[0]?.motivo).toBe('manual');
    expect(rows[0]?.cierre).toBe(NOW.toISOString());
  });

  it('reports no closure when there is no sesionId in the trusted claims', async () => {
    await seedSession(2);

    const response = await closeSessionWithExecutor(
      testDb!.db,
      schema,
      undefined,
      deps,
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual({ closed: false });
    }

    const rows = await testDb!.db.all<{ cierre: string | null }>(
      sql`SELECT sesion_fecha_hora_cierre AS cierre FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    expect(rows[0]?.cierre ?? null).toBeNull();
  });

  it('is idempotent: a second logout does not alter the already closed row', async () => {
    await seedSession(2);

    await closeSessionWithExecutor(
      testDb!.db,
      schema,
      SESSION_ID,
      deps,
    );

    const second = await closeSessionWithExecutor(
      testDb!.db,
      schema,
      SESSION_ID,
      { now: () => new Date(NOW.getTime() + 60_000) },
    );

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data).toEqual({ closed: false });
    }

    const rows = await testDb!.db.all<{ cierre: string | null }>(
      sql`SELECT sesion_fecha_hora_cierre AS cierre FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    // El cierre conserva el instante del primer logout (NOW), no el segundo.
    expect(rows[0]?.cierre).toBe(NOW.toISOString());
  });
});

describe('refreshSessionActivity (actividad real del usuario, RF55)', () => {
  it('refreshes the last access time for an open session', async () => {
    // 5 min de inactividad previa; una acción real la lleva a NOW.
    await seedSession(5);

    await refreshSessionActivity(testDb!.db, schema, SESSION_ID, deps);

    const rows = await testDb!.db.all<{ ultimo: string }>(
      sql`SELECT sesion_fecha_hora_ultimo_acceso AS ultimo FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    expect(rows[0]?.ultimo).toBe(NOW.toISOString());
  });

  it('does nothing when there is no sesionId', async () => {
    await seedSession(5);
    const ultimoAccesoOriginal = new Date(
      NOW.getTime() - 5 * 60_000,
    ).toISOString();

    await refreshSessionActivity(testDb!.db, schema, undefined, deps);

    const rows = await testDb!.db.all<{ ultimo: string }>(
      sql`SELECT sesion_fecha_hora_ultimo_acceso AS ultimo FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    expect(rows[0]?.ultimo).toBe(ultimoAccesoOriginal);
  });

  it('does NOT revive a session already closed (cierre IS NOT NULL)', async () => {
    // Sesión cerrada por inactividad: una acción posterior no debe reabrirla ni
    // mover su último acceso.
    await seedSession(5);
    await closeSessionWithExecutor(testDb!.db, schema, SESSION_ID, deps);

    const ultimoAccesoOriginal = new Date(
      NOW.getTime() - 5 * 60_000,
    ).toISOString();

    await refreshSessionActivity(testDb!.db, schema, SESSION_ID, {
      now: () => new Date(NOW.getTime() + 60_000),
    });

    const rows = await testDb!.db.all<{ ultimo: string; cierre: string | null }>(
      sql`SELECT sesion_fecha_hora_ultimo_acceso AS ultimo, sesion_fecha_hora_cierre AS cierre FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    // La fila sigue cerrada y su último acceso no se movió.
    expect(rows[0]?.cierre).not.toBeNull();
    expect(rows[0]?.ultimo).toBe(ultimoAccesoOriginal);
  });
});
