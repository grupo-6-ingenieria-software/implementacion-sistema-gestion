/**
 * SesionHandler — Verificación de sesión e inactividad (RF55, CU56 e4).
 *
 * Canal auth:verificar-sesion. La sesión se cierra automáticamente tras 30
 * minutos de inactividad; cada verificación válida refresca el último acceso.
 * El proceso main complementa esto con un aviso push session:expirada
 * (ver main/index.ts).
 */

import { eq } from 'drizzle-orm';
import { controllers, type ControllerResponse } from '../../shared/controllers';
import { INACTIVITY_MS } from '../../shared/auth';
import { db, schema as appSchema } from '../../db/client';
import { controllerSuccess, type RegisteredController } from './base';
import { verifySessionToken, type SessionTokenClaims } from './auth-jwt';

type SchemaLike = typeof import('../../db/schema');
type SessionExecutor = Pick<typeof db, 'select' | 'update'>;

export type VerifySessionPayload = {
  token?: string;
};

export type SessionInactiveReason =
  | 'token-invalido'
  | 'sesion-inexistente'
  | 'inactividad'
  | 'manual'
  | 'sistema';

export type VerifySessionData = {
  active: boolean;
  reason?: SessionInactiveReason;
};

export type SessionDeps = {
  verifyToken: (token: unknown) => SessionTokenClaims | null;
  now: () => Date;
};

const defaultDeps: SessionDeps = {
  verifyToken: verifySessionToken,
  now: () => new Date(),
};

export async function verifySessionWithExecutor(
  database: SessionExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: SessionDeps = defaultDeps,
): Promise<ControllerResponse<VerifySessionData>> {
  const input = payload as VerifySessionPayload | null;
  const claims = deps.verifyToken(input?.token);

  if (!claims) {
    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: 'token-invalido',
    });
  }

  const [sesion] = await database
    .select({
      cierre: schema.sesionUsuario.sesionFechaHoraCierre,
      motivoCierre: schema.sesionUsuario.sesionMotivoCierre,
      ultimoAcceso: schema.sesionUsuario.sesionFechaHoraUltimoAcceso,
    })
    .from(schema.sesionUsuario)
    .where(eq(schema.sesionUsuario.sesionUsuarioId, claims.sesionId))
    .limit(1);

  if (!sesion) {
    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: 'sesion-inexistente',
    });
  }

  if (sesion.cierre) {
    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: normalizeReason(sesion.motivoCierre),
    });
  }

  const now = deps.now();
  const idleMs = now.getTime() - Date.parse(sesion.ultimoAcceso);

  if (idleMs > INACTIVITY_MS) {
    await database
      .update(schema.sesionUsuario)
      .set({
        sesionFechaHoraCierre: now.toISOString(),
        sesionMotivoCierre: 'inactividad',
      })
      .where(eq(schema.sesionUsuario.sesionUsuarioId, claims.sesionId));

    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: 'inactividad',
    });
  }

  // Sesión activa: refrescar el último acceso.
  await database
    .update(schema.sesionUsuario)
    .set({ sesionFechaHoraUltimoAcceso: now.toISOString() })
    .where(eq(schema.sesionUsuario.sesionUsuarioId, claims.sesionId));

  return controllerSuccess<VerifySessionData>({ active: true });
}

function normalizeReason(motivo: string | null): SessionInactiveReason {
  if (motivo === 'inactividad' || motivo === 'manual' || motivo === 'sistema') {
    return motivo;
  }

  return 'sistema';
}

export function createSessionController(
  deps: Partial<SessionDeps> = {},
): RegisteredController<VerifySessionPayload, VerifySessionData> {
  const resolved: SessionDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[4],
    handle: (payload) =>
      verifySessionWithExecutor(db, appSchema, payload, resolved),
  };
}

export const sessionController = createSessionController();
