/**
 * Guard de identidad y rol en el borde IPC (RF56, CU57).
 *
 * El renderer envía el JWT de sesión adjunto en cada invoke como `__authToken`
 * (ver preload/index.ts). El dispatcher (ver index.ts) llama a `guardChannel`
 * antes de despachar al controlador, de modo que la identidad y el rol se
 * derivan del token firmado y NO de parámetros que el renderer pueda falsificar.
 *
 * Política por canal:
 *  - PUBLIC:        sin token (sólo `auth:login`).
 *  - AUTHENTICATED: token válido de cualquier rol.
 *  - ROLE-GATED:    token válido + rol permitido, derivado del árbol de
 *                   navegación (`node.roles` por controlador).
 */

import { controllers } from '../../shared/controllers';
import type { ControllerId, Role } from '../../shared/navigation';
import { navigationTree } from '../../shared/navigation';
import { controllerError } from './base';
import type { ControllerContext } from './base';
import { verifySessionToken, type SessionTokenClaims } from './auth-jwt';
import { registerAuditLog } from './auth-context';
import { db, schema as appSchema } from '../../db/client';

/** Único canal público: sin él no se podría iniciar sesión. */
export const PUBLIC_CHANNELS: ReadonlySet<string> = new Set(['auth:login']);

/**
 * Canales que sólo exigen una sesión válida (cualquier rol). El cambio de
 * contraseña obligatorio, la verificación de sesión, el cierre de sesión y el
 * registro de auditoría aplican a ambos roles.
 */
export const AUTHENTICATED_CHANNELS: ReadonlySet<string> = new Set([
  'auth:cambiar-password',
  'auth:restablecer-password',
  'auth:verificar-sesion',
  'auth:logout',
  'auditoria:registrar',
]);

/**
 * Roles permitidos por canal, derivados del árbol de navegación: para cada
 * canal se toma la unión de `node.roles` de todos los nodos cuyo controlador
 * declara dicho canal. Así el mapeo se mantiene en sincronía con la navegación
 * en lugar de hardcodearse.
 */
export const CHANNEL_ROLES: ReadonlyMap<string, ReadonlySet<Role>> =
  buildChannelRoleMap();

function buildChannelRoleMap(): Map<string, Set<Role>> {
  const controllerRoles = new Map<ControllerId, Set<Role>>();

  for (const node of navigationTree) {
    for (const controllerId of node.controllerIds) {
      const roles =
        controllerRoles.get(controllerId) ?? new Set<Role>();
      for (const role of node.roles) {
        roles.add(role);
      }
      controllerRoles.set(controllerId, roles);
    }
  }

  const channelRoles = new Map<string, Set<Role>>();

  for (const controller of controllers) {
    const roles = controllerRoles.get(controller.id);

    if (!roles || roles.size === 0) {
      continue;
    }

    for (const channel of controller.channels) {
      if (
        PUBLIC_CHANNELS.has(channel) ||
        AUTHENTICATED_CHANNELS.has(channel)
      ) {
        continue;
      }

      channelRoles.set(channel, new Set(roles));
    }
  }

  return channelRoles;
}

export type GuardDeps = {
  verifyToken: (token: unknown) => SessionTokenClaims | null;
  audit: (event: {
    descripcion: string;
    modulo: string;
    tipoAccion: string;
    usuarioId: string;
  }) => Promise<void>;
};

const defaultDeps: GuardDeps = {
  verifyToken: verifySessionToken,
  audit: (event) => registerAuditLog(db, appSchema, event),
};

export type GuardResult =
  | { ok: true; context: ControllerContext; payload: unknown }
  | { ok: false; response: ReturnType<typeof controllerError> };

/**
 * Verifica el token del payload según la política del canal. En caso de éxito
 * para un canal autenticado/role-gated, sobrescribe `payload.usuarioId` con la
 * identidad de confianza y adjunta los claims al contexto del controlador.
 */
export async function guardChannel(
  channel: string,
  payload: unknown,
  deps: GuardDeps = defaultDeps,
): Promise<GuardResult> {
  const baseContext: ControllerContext = { channel };

  if (PUBLIC_CHANNELS.has(channel)) {
    return { ok: true, context: baseContext, payload };
  }

  const token = extractToken(payload);
  const claims = deps.verifyToken(token);

  if (!claims) {
    return {
      ok: false,
      response: controllerError(
        'FORBIDDEN',
        'No hay una sesión válida para realizar esta acción.',
      ),
    };
  }

  const requiredRoles = CHANNEL_ROLES.get(channel);

  if (requiredRoles && !requiredRoles.has(claims.rol)) {
    await deps
      .audit({
        descripcion: `Acceso denegado al canal ${channel} para el rol ${claims.rol}.`,
        modulo: 'control_acceso',
        tipoAccion: 'acceso_denegado',
        usuarioId: claims.usuarioId,
      })
      .catch(() => undefined);

    return {
      ok: false,
      response: controllerError(
        'FORBIDDEN',
        'No tiene permiso para realizar esta acción.',
      ),
    };
  }

  // Sobrescribe la identidad con la de confianza y adjunta los claims, de modo
  // que los `authorizeUser(payload.usuarioId, ...)` existentes operen sobre el
  // usuario verificado sin tener que editar cada controlador.
  const trustedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), usuarioId: claims.usuarioId }
      : payload;

  return {
    ok: true,
    context: { channel, claims },
    payload: trustedPayload,
  };
}

function extractToken(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return (payload as Record<string, unknown>).__authToken;
  }

  return undefined;
}
