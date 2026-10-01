import { controllers } from "../../shared/controllers";
import { isReportExportRequest } from "../../shared/reports";
import type { ControllerId, Role } from "../../shared/navigation";
import { navigationTree } from "../../shared/navigation";
import { controllerError } from "./base";
import type { ControllerContext } from "./base";
import { verifySessionToken, type SessionTokenClaims } from "./auth-jwt";
import { registerAuditLog } from "./auth-context";
import { db, schema as appSchema } from "../../db/client";
import {
  NON_ACTIVITY_CHANNELS,
  validateAndRefreshActiveSession,
  type VerifySessionData,
} from "./session";
import { SESSION_EXPIRED_MESSAGE, SESSION_INVALIDATED_MESSAGE } from "../../shared/auth";

export const PUBLIC_CHANNELS: ReadonlySet<string> = new Set(["auth:login"]);

export const AUTHENTICATED_CHANNELS: ReadonlySet<string> = new Set([
  "auth:cambiar-password",
  "auth:preparar-restablecimiento",
  "auth:restablecer-password",
  "auth:verificar-sesion",
  "auth:logout",
  "auditoria:registrar",
]);

export const TEMP_PASSWORD_CHANNELS: ReadonlySet<string> = new Set([
  "auth:cambiar-password",
  "auth:verificar-sesion",
  "auth:logout",
]);

export const CHANNEL_ROLE_OVERRIDES: ReadonlyMap<
  string,
  ReadonlySet<Role>
> = new Map<string, ReadonlySet<Role>>([
  ["auth:preparar-restablecimiento", new Set<Role>(["dueno"])],
  ["auth:restablecer-password", new Set<Role>(["dueno"])],
  ["auditoria:consultar", new Set<Role>(["dueno"])],
  ["turno:listar", new Set<Role>(["dueno", "trabajador"])],
  ["turno:crear", new Set<Role>(["dueno"])],
  ["turno:editar", new Set<Role>(["dueno"])],
  ["turno:eliminar", new Set<Role>(["dueno"])],
  ["trabajador:listar-activos", new Set<Role>(["dueno", "trabajador"])],
  ["trabajador:registrar", new Set<Role>(["dueno"])],
  ["trabajador:actualizar", new Set<Role>(["dueno"])],
  ["trabajador:cambiar-estado", new Set<Role>(["dueno"])],
]);

export const CHANNEL_ROLES: ReadonlyMap<
  string,
  ReadonlySet<Role>
> = buildChannelRoleMap();

function buildChannelRoleMap(): Map<string, Set<Role>> {
  const controllerRoles = new Map<ControllerId, Set<Role>>();

  for (const node of navigationTree) {
    for (const controllerId of node.controllerIds) {
      const roles = controllerRoles.get(controllerId) ?? new Set<Role>();
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
      if (PUBLIC_CHANNELS.has(channel) || AUTHENTICATED_CHANNELS.has(channel)) {
        continue;
      }

      channelRoles.set(channel, new Set(roles));
    }
  }

  for (const [channel, roles] of CHANNEL_ROLE_OVERRIDES) {
    channelRoles.set(channel, new Set(roles));
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

export type RequestAuthorizationDeps = {
  identity: typeof authenticateChannel;
  session: (
    claims: SessionTokenClaims,
    refresh: boolean,
  ) => Promise<VerifySessionData>;
  audit?: (event: {
    descripcion: string;
    modulo: string;
    tipoAccion: string;
    usuarioId: string;
  }) => Promise<void>;
};

const defaultAuthorizeAudit: NonNullable<
  RequestAuthorizationDeps["audit"]
> = (event) => registerAuditLog(db, appSchema, event);

export async function authorizeRequest(
  channel: string,
  payload: unknown,
  onExpired: () => void = () => undefined,
  deps: RequestAuthorizationDeps = {
    // El rol se evalúa después de confirmar la sesión (CU58-E1, pasos 3-13).
    identity: authenticateChannel,
    session: (claims, refresh) =>
      validateAndRefreshActiveSession(
        db,
        appSchema,
        claims.sesionId,
        claims.usuarioId,
        refresh,
      ),
  },
): Promise<GuardResult> {
  try {
    const result = await deps.identity(channel, payload);
    if (!result.ok || !result.context.claims) return result;
    const claims = result.context.claims;
    const session = await deps.session(
      claims,
      !NON_ACTIVITY_CHANNELS.has(channel),
    );
    if (!session.active) {
      if (session.reason === "inactividad") {
        onExpired();
      }
      return {
        ok: false,
        response: controllerError(
          "FORBIDDEN",
          session.reason === "inactividad"
            ? SESSION_EXPIRED_MESSAGE
            : session.reason === "sistema"
              ? SESSION_INVALIDATED_MESSAGE
              : "No hay una sesión válida para realizar esta acción.",
        ),
      };
    }

    const rolEfectivo = session.rolEfectivo ?? claims.rol;
    const requiredRoles = isReportExportRequest(channel, payload) ? new Set<Role>(["dueno"]) : CHANNEL_ROLES.get(channel);

    if (requiredRoles && !requiredRoles.has(rolEfectivo)) {
      await (deps.audit ?? defaultAuthorizeAudit)({
        descripcion: `Acceso denegado al canal ${channel} para el rol ${rolEfectivo}.`,
        modulo: "control_acceso",
        tipoAccion: "acceso_denegado",
        usuarioId: claims.usuarioId,
      }).catch(() => undefined);

      return {
        ok: false,
        response: controllerError(
          "FORBIDDEN",
          "No tiene permiso para realizar esta acción.",
        ),
      };
    }

    claims.rol = rolEfectivo;

    if (
      result.payload &&
      typeof result.payload === "object" &&
      !Array.isArray(result.payload)
    ) {
      result.payload = {
        ...(result.payload as Record<string, unknown>),
        __rolSesion: rolEfectivo,
      };
    }

    return result;
  } catch (error) {
    console.error("Error al validar la sesión", error);
    return {
      ok: false,
      response: controllerError(
        "TECHNICAL_ERROR",
        "No fue posible verificar la sesión. Intente nuevamente.",
      ),
    };
  }
}

// Identidad, rol del JWT y auditoría de la denegación, sin consultar la sesión.
export async function guardChannel(
  channel: string,
  payload: unknown,
  deps: GuardDeps = defaultDeps,
): Promise<GuardResult> {
  const result = await authenticateChannel(channel, payload, deps);
  if (!result.ok || !result.context.claims) return result;
  const claims = result.context.claims;
  const requiredRoles = isReportExportRequest(channel, payload) ? new Set<Role>(["dueno"]) : CHANNEL_ROLES.get(channel);

  if (requiredRoles && !requiredRoles.has(claims.rol)) {
    await deps
      .audit({
        descripcion: `Acceso denegado al canal ${channel} para el rol ${claims.rol}.`,
        modulo: "control_acceso",
        tipoAccion: "acceso_denegado",
        usuarioId: claims.usuarioId,
      })
      .catch(() => undefined);

    return {
      ok: false,
      response: controllerError(
        "FORBIDDEN",
        "No tiene permiso para realizar esta acción.",
      ),
    };
  }

  return result;
}

// Verifica firma e identidad del JWT; el rol lo decide quien confirme la sesión.
export async function authenticateChannel(
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
        "FORBIDDEN",
        "No hay una sesión válida para realizar esta acción.",
      ),
    };
  }

  if (claims.passwordTemporal && !TEMP_PASSWORD_CHANNELS.has(channel)) {
    await deps.audit({
      descripcion: `Acceso denegado al canal ${channel}: cambio de contraseña obligatorio.`,
      modulo: "control_acceso",
      tipoAccion: "acceso_denegado",
      usuarioId: claims.usuarioId,
    }).catch(() => undefined);
    return {
      ok: false,
      response: controllerError(
        "FORBIDDEN",
        "Debe cambiar la contraseña temporal antes de realizar esta acción.",
      ),
    };
  }

  // Sobrescribe la identidad con la de confianza y adjunta los claims, de modo
  // que los `authorizeUser(payload.usuarioId, ...)` existentes operen sobre el
  // usuario verificado sin tener que editar cada controlador.
  const trustedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), usuarioId: claims.usuarioId }
      : payload;

  return {
    ok: true,
    context: { channel, claims },
    payload: trustedPayload,
  };
}

function extractToken(payload: unknown): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return (payload as Record<string, unknown>).__authToken;
  }

  return undefined;
}
