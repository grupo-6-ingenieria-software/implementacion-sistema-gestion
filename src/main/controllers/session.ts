/**
 * SesionHandler — Verificación de sesión, inactividad y cierre (RF55, CU56 e4).
 *
 * Es la única fuente de verdad sobre el estado de la sesión en la base de datos:
 *  - Canal auth:verificar-sesion: latido (heartbeat) del renderer. La sesión se
 *    cierra automáticamente tras 30 minutos de inactividad (motivo_cierre =
 *    'inactividad'); cada verificación válida refresca el último acceso.
 *  - Canal auth:logout: cierre manual de la sesión activa (motivo_cierre =
 *    'manual'), invocado por el renderer al cerrar sesión.
 *
 * La identidad se deriva del JWT verificado por el guard del dispatcher; el
 * sesionId proviene de los claims firmados (ver auth-guard.ts / auth-jwt.ts).
 */

import { and, eq, isNull } from 'drizzle-orm';
import { controllers, type ControllerResponse } from '../../shared/controllers';
import { INACTIVITY_MS } from '../../shared/auth';
import { db, schema as appSchema } from '../../db/client';
import {
  controllerSuccess,
  type ControllerContext,
  type RegisteredController,
} from './base';
import { verifySessionToken, type SessionTokenClaims } from './auth-jwt';

type SchemaLike = typeof import('../../db/schema');
type SessionExecutor = Pick<typeof db, 'select' | 'update'>;

export const LOGOUT_CHANNEL = 'auth:logout';

export type VerifySessionPayload = {
  token?: string;
};

export type LogoutData = {
  closed: boolean;
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

/**
 * Cierra manualmente la sesión activa identificada por su sesionId (CU56). Marca
 * sesion_fecha_hora_cierre = ahora y sesion_motivo_cierre = 'manual'. El
 * sesionId proviene de los claims del JWT que el dispatcher verifica y adjunta al
 * contexto (no de un parámetro del renderer). La actualización sólo afecta a la
 * sesión aún abierta (cierre IS NULL), por lo que es idempotente: un segundo
 * logout sobre una sesión ya cerrada no la altera.
 */
export async function closeSessionWithExecutor(
  database: SessionExecutor,
  schema: SchemaLike,
  sesionId: string | undefined,
  deps: SessionDeps = defaultDeps,
): Promise<ControllerResponse<LogoutData>> {
  if (!sesionId) {
    return controllerSuccess<LogoutData>({ closed: false });
  }

  const now = deps.now();

  const updated = await database
    .update(schema.sesionUsuario)
    .set({
      sesionFechaHoraCierre: now.toISOString(),
      sesionMotivoCierre: 'manual',
    })
    .where(
      and(
        eq(schema.sesionUsuario.sesionUsuarioId, sesionId),
        isNull(schema.sesionUsuario.sesionFechaHoraCierre),
      ),
    )
    .returning({ id: schema.sesionUsuario.sesionUsuarioId });

  return controllerSuccess<LogoutData>({ closed: updated.length > 0 });
}

function normalizeReason(motivo: string | null): SessionInactiveReason {
  if (motivo === 'inactividad' || motivo === 'manual' || motivo === 'sistema') {
    return motivo;
  }

  return 'sistema';
}

export function createSessionController(
  deps: Partial<SessionDeps> = {},
): RegisteredController<VerifySessionPayload, VerifySessionData | LogoutData> {
  const resolved: SessionDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[4],
    handle: (payload, context: ControllerContext) => {
      if (context.channel === LOGOUT_CHANNEL) {
        // El sesionId proviene del claim firmado adjuntado por el guard, no del
        // renderer; así no se puede cerrar la sesión de otro usuario.
        return closeSessionWithExecutor(
          db,
          appSchema,
          context.claims?.sesionId,
          resolved,
        );
      }

      return verifySessionWithExecutor(db, appSchema, payload, resolved);
    },
  };
}

export const sessionController = createSessionController();
