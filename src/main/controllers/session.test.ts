import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { verifySessionWithExecutor, type SessionDeps } from './session';
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
