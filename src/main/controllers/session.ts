/**
 * SesionHandler — Verificación de sesión, inactividad y cierre (RF55, CU56 e4).
 *
 * Es la única fuente de verdad sobre el estado de la sesión en la base de datos:
 *  - Canal auth:verificar-sesion: latido (heartbeat) del renderer. SÓLO consulta
 *    el estado de la sesión: si lleva más de 30 minutos sin actividad real la
 *    cierra (motivo_cierre = 'inactividad'); en caso contrario responde
 *    active=true SIN refrescar el último acceso. El latido es de SÓLO LECTURA,
 *    por lo que NO reinicia el contador de inactividad mientras la app está
 *    abierta sin que el usuario haga nada.
 *  - Canal auth:logout: cierre manual de la sesión activa (motivo_cierre =
 *    'manual'), invocado por el renderer al cerrar sesión.
 *
 * El último acceso (sesion_fecha_hora_ultimo_acceso) lo refresca el dispatcher
 * (ver index.ts) en cada IPC autenticado que represente una ACCIÓN real del
 * usuario, EXCEPTO el propio latido (auth:verificar-sesion) y el logout
 * (auth:logout). Así la inactividad sólo se acumula cuando no hay acciones.
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

type SchemaLike = typeof import('../../db/schema');
type SessionExecutor = Pick<typeof db, 'select' | 'update'>;

export const LOGOUT_CHANNEL = 'auth:logout';
export const VERIFY_SESSION_CHANNEL = 'auth:verificar-sesion';

/**
 * Canales que NO cuentan como actividad del usuario y por tanto NO deben
 * refrescar sesion_fecha_hora_ultimo_acceso: el latido (sólo consulta) y el
 * cierre de sesión (no tiene sentido refrescar una sesión que se está cerrando).
 * El dispatcher refresca el último acceso en cualquier otro canal autenticado.
 */
export const NON_ACTIVITY_CHANNELS: ReadonlySet<string> = new Set([
  VERIFY_SESSION_CHANNEL,
  LOGOUT_CHANNEL,
]);

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
  now: () => Date;
};

const defaultDeps: SessionDeps = {
  now: () => new Date(),
};

/**
 * Verifica la vigencia de la sesión identificada por `sesionId`. El JWT ya fue
 * verificado por el guard del dispatcher (auth-guard.ts), que es la única fuente
 * de verificación de tokens; aquí se confía en el sesionId de los claims, igual
 * que en el cierre de sesión. No se vuelve a leer ningún token del payload (el
 * renderer lo envía como `__authToken`, no como `token`).
 */
export async function verifySessionWithExecutor(
  database: SessionExecutor,
  schema: SchemaLike,
  sesionId: string | undefined,
  deps: SessionDeps = defaultDeps,
): Promise<ControllerResponse<VerifySessionData>> {
  if (!sesionId) {
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
    .where(eq(schema.sesionUsuario.sesionUsuarioId, sesionId))
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
      .where(eq(schema.sesionUsuario.sesionUsuarioId, sesionId));

    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: 'inactividad',
    });
  }

  // Sesión activa dentro de la ventana de actividad. El latido es de SÓLO
  // LECTURA: NO refresca el último acceso, para que la inactividad se acumule
  // mientras el usuario no realice ninguna acción (ver refreshSessionActivity,
  // invocada por el dispatcher en los IPC de acción real).
  return controllerSuccess<VerifySessionData>({ active: true });
}

/**
 * Refresca sesion_fecha_hora_ultimo_acceso = ahora para la sesión indicada,
 * marcando actividad real del usuario. Lo invoca el dispatcher (index.ts) tras
 * un guard exitoso en cualquier IPC autenticado que NO sea el latido ni el
 * logout. Sólo afecta a sesiones aún abiertas (cierre IS NULL): una sesión ya
 * cerrada por inactividad o logout no se "revive" con un UPDATE de actividad.
 * Es un único UPDATE; cualquier fallo de BD se ignora para no bloquear la
 * acción del usuario (la actividad es un efecto secundario, no el objetivo).
 */
export async function refreshSessionActivity(
  database: SessionExecutor,
  schema: SchemaLike,
  sesionId: string | undefined,
  deps: SessionDeps = defaultDeps,
): Promise<void> {
  if (!sesionId) {
    return;
  }

  const now = deps.now();

  await database
    .update(schema.sesionUsuario)
    .set({ sesionFechaHoraUltimoAcceso: now.toISOString() })
    .where(
      and(
        eq(schema.sesionUsuario.sesionUsuarioId, sesionId),
        isNull(schema.sesionUsuario.sesionFechaHoraCierre),
      ),
    );
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
): RegisteredController<unknown, VerifySessionData | LogoutData> {
  const resolved: SessionDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[4],
    handle: (_payload, context: ControllerContext) => {
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

      // Igual que el logout: el sesionId de confianza viene del guard. Antes se
      // re-leía payload.token (inexistente: el preload envía __authToken), por lo
      // que el latido siempre respondía inactivo y cerraba la sesión.
      return verifySessionWithExecutor(
        db,
        appSchema,
        context.claims?.sesionId,
        resolved,
      );
    },
  };
}

export const sessionController = createSessionController();
