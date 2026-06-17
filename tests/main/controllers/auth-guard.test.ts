import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/db/schema';
import {
  CHANNEL_ROLES,
  PUBLIC_CHANNELS,
  guardChannel,
  type GuardDeps,
} from '../../../src/main/controllers/auth-guard';
import { registerAuditLog } from '../../../src/main/controllers/auth-context';
import type { SessionTokenClaims } from '../../../src/main/controllers/auth-jwt';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from '../../../src/main/controllers/auth-fixtures';

function claimsFor(rol: 'dueno' | 'trabajador'): SessionTokenClaims {
  return {
    usuarioId: 'trusted-id',
    rol,
    usuarioRol: rol,
    passwordTemporal: false,
    sesionId: '00000000-0000-4000-8000-000000000777',
  };
}

function deps(overrides: Partial<GuardDeps>): GuardDeps {
  return {
    verifyToken: () => null,
    audit: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('guardChannel (RF56/CU57)', () => {
  it('lets the only public channel through without a token', async () => {
    expect(PUBLIC_CHANNELS.has('auth:login')).toBe(true);

    const result = await guardChannel('auth:login', { usuario: 'x' }, deps({}));

    expect(result.ok).toBe(true);
  });

  it('rejects a sensitive channel with a missing/invalid token (FORBIDDEN)', async () => {
    const result = await guardChannel(
      'producto:registrar',
      { usuarioId: 'spoofed', __authToken: 'garbage' },
      deps({ verifyToken: () => null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.ok).toBe(false);
      if (!result.response.ok) {
        expect(result.response.error.code).toBe('FORBIDDEN');
      }
    }
  });

  it('denies a wrong-role token on a dueno-only channel and audits it', async () => {
    const audit = vi.fn(async () => undefined);

    const result = await guardChannel(
      'producto:registrar',
      { usuarioId: 'spoofed', __authToken: 't' },
      deps({ verifyToken: () => claimsFor('trabajador'), audit }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.ok) {
      expect(result.response.error.code).toBe('FORBIDDEN');
    }
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAccion: 'acceso_denegado',
        usuarioId: 'trusted-id',
      }),
    );
  });

  it('overwrites a spoofed usuarioId with the trusted claim identity', async () => {
    const result = await guardChannel(
      'producto:registrar',
      { usuarioId: 'spoofed-attacker', nombre: 'x', __authToken: 't' },
      deps({ verifyToken: () => claimsFor('dueno') }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as { usuarioId: string; nombre: string };
      expect(payload.usuarioId).toBe('trusted-id');
      expect(payload.nombre).toBe('x');
      expect(result.context.claims?.usuarioId).toBe('trusted-id');
    }
  });

  it('allows an authenticated-only channel for any valid role', async () => {
    const result = await guardChannel(
      'auditoria:registrar',
      { __authToken: 't' },
      deps({ verifyToken: () => claimsFor('trabajador') }),
    );

    expect(result.ok).toBe(true);
    expect(CHANNEL_ROLES.has('auditoria:registrar')).toBe(false);
  });

  it('derives dueno-only gating from the navigation tree', () => {
    expect(CHANNEL_ROLES.get('producto:registrar')).toEqual(new Set(['dueno']));
    expect(CHANNEL_ROLES.get('venta:registrar')).toEqual(
      new Set(['dueno', 'trabajador']),
    );
  });

  it('lets trabajador list active workers for Asistencia (cross-module override)', async () => {
    // `trabajador:listar-activos` lo expone el controlador worker, que en la
    // navegación sólo aparece bajo nodos de dueño; el override lo habilita para
    // trabajador porque la vista de Asistencia (RF29/RF30) lo necesita para
    // seleccionar al trabajador desde la lista de activos.
    expect(CHANNEL_ROLES.get('trabajador:listar-activos')).toEqual(
      new Set(['dueno', 'trabajador']),
    );

    const result = await guardChannel(
      'trabajador:listar-activos',
      { __authToken: 't' },
      deps({ verifyToken: () => claimsFor('trabajador') }),
    );

    expect(result.ok).toBe(true);
  });

  it('still gates worker management channels to dueno only', () => {
    expect(CHANNEL_ROLES.get('trabajador:listar')).toEqual(new Set(['dueno']));
    expect(CHANNEL_ROLES.get('trabajador:registrar')).toEqual(
      new Set(['dueno']),
    );
  });
});

describe('guardChannel audit persistence', () => {
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

  it('persists an acceso_denegado row on role mismatch', async () => {
    await seedUser(testDb!.db, {
      usuarioId: 'trusted-id',
      trabajadorId: 1,
      rut: '12345678-9',
      rolBd: 'trabajador',
    });

    const result = await guardChannel(
      'producto:registrar',
      { __authToken: 't' },
      {
        verifyToken: () => claimsFor('trabajador'),
        audit: (event) => registerAuditLog(testDb!.db, schema, event),
      },
    );

    expect(result.ok).toBe(false);

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_denegado'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });
});
