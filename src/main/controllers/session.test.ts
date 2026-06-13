import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import {
  closeSessionWithExecutor,
  verifySessionWithExecutor,
  type SessionDeps,
} from './session';
import type { SessionTokenClaims } from './auth-jwt';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from './auth-fixtures';

const NOW = new Date('2026-06-13T12:00:00.000Z');
const SESSION_ID = '00000000-0000-4000-8000-000000000777';

const claims: SessionTokenClaims = {
  usuarioId: '12345678-9',
  rol: 'dueno',
  usuarioRol: 'dueno',
  passwordTemporal: false,
  sesionId: SESSION_ID,
};

function depsWith(token: SessionTokenClaims | null): SessionDeps {
  return { verifyToken: () => token, now: () => NOW };
}

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
  it('reports an invalid token as inactive', async () => {
    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      { token: 'whatever' },
      depsWith(null),
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
      { token: 't' },
      depsWith(claims),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.reason).toBe('sesion-inexistente');
    }
  });

  it('keeps an active session and refreshes the last access time', async () => {
    await seedSession(5);

    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      { token: 't' },
      depsWith(claims),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.active).toBe(true);
    }

    const rows = await testDb!.db.all<{ ultimo: string }>(
      sql`SELECT sesion_fecha_hora_ultimo_acceso AS ultimo FROM sesion_usuario WHERE sesion_usuario_id = ${SESSION_ID}`,
    );
    expect(rows[0]?.ultimo).toBe(NOW.toISOString());
  });

  it('closes a session after 30 minutes of inactivity', async () => {
    await seedSession(31);

    const response = await verifySessionWithExecutor(
      testDb!.db,
      schema,
      { token: 't' },
      depsWith(claims),
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
      claims.sesionId,
      depsWith(claims),
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
      depsWith(null),
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
      claims.sesionId,
      depsWith(claims),
    );

    const second = await closeSessionWithExecutor(
      testDb!.db,
      schema,
      claims.sesionId,
      { verifyToken: () => claims, now: () => new Date(NOW.getTime() + 60_000) },
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
