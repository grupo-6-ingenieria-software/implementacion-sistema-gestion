import { and, eq, isNull, sql } from "drizzle-orm";
import { controllers, type ControllerResponse } from "../../shared/controllers";
import { INACTIVITY_MS } from "../../shared/auth";
import type { Role } from "../../shared/navigation";
import { db, schema as appSchema } from "../../db/client";
import {
  controllerSuccess,
  type ControllerContext,
  type RegisteredController,
} from "./base";
import { mapDatabaseRoleToTechnicalRole } from "./auth-context";

type SchemaLike = typeof import("../../db/schema");
type SessionExecutor = Pick<typeof db, "select" | "update">;

export const LOGOUT_CHANNEL = "auth:logout";
export const VERIFY_SESSION_CHANNEL = "auth:verificar-sesion";

export const NON_ACTIVITY_CHANNELS: ReadonlySet<string> = new Set([
  VERIFY_SESSION_CHANNEL,
  LOGOUT_CHANNEL,
]);

export type LogoutData = {
  closed: boolean;
};

export type SessionInactiveReason =
  | "token-invalido"
  | "sesion-inexistente"
  | "inactividad"
  | "manual"
  | "sistema";

export type VerifySessionData = {
  active: boolean;
  reason?: SessionInactiveReason;
  rolEfectivo?: Role;
};

export type SessionDeps = {
  now: () => Date;
};

const defaultDeps: SessionDeps = {
  now: () => new Date(),
};

export async function verifySessionWithExecutor(
  database: SessionExecutor,
  schema: SchemaLike,
  sesionId: string | undefined,
  deps: SessionDeps = defaultDeps,
): Promise<ControllerResponse<VerifySessionData>> {
  if (!sesionId) {
    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: "token-invalido",
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
      reason: "sesion-inexistente",
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

  if (!Number.isFinite(idleMs) || idleMs >= INACTIVITY_MS) {
    await database
      .update(schema.sesionUsuario)
      .set({
        sesionFechaHoraCierre: now.toISOString(),
        sesionMotivoCierre: "inactividad",
      })
      .where(eq(schema.sesionUsuario.sesionUsuarioId, sesionId));

    return controllerSuccess<VerifySessionData>({
      active: false,
      reason: "inactividad",
    });
  }

  return controllerSuccess<VerifySessionData>({ active: true });
}

export async function validateAndRefreshActiveSession(
  database: Pick<typeof db, "transaction">,
  schema: SchemaLike,
  sesionId: string,
  usuarioId: string,
  refresh: boolean,
  deps: SessionDeps = defaultDeps,
): Promise<VerifySessionData> {
  return database.transaction(async (tx) => {
    const now = deps.now();

    if (!refresh) {
      return inspectSessionState(tx, schema, sesionId, usuarioId, now, false);
    }

    const inactivityBoundary = new Date(
      now.getTime() - INACTIVITY_MS,
    ).toISOString();
    const renewed = await tx
      .update(schema.sesionUsuario)
      .set({ sesionFechaHoraUltimoAcceso: now.toISOString() })
      .where(
        and(
          eq(schema.sesionUsuario.sesionUsuarioId, sesionId),
          eq(schema.sesionUsuario.usuarioId, usuarioId),
          isNull(schema.sesionUsuario.sesionFechaHoraCierre),
          sql`julianday(${schema.sesionUsuario.sesionFechaHoraUltimoAcceso}) IS NOT NULL`,
          sql`julianday(${schema.sesionUsuario.sesionFechaHoraUltimoAcceso}) > julianday(${inactivityBoundary})`,
        ),
      )
      .returning({
        id: schema.sesionUsuario.sesionUsuarioId,
        rolEfectivo: schema.sesionUsuario.sesionRolEfectivo,
      });

    if (renewed.length > 0) {
      return {
        active: true,
        rolEfectivo: await resolveSessionRolEfectivo(
          tx,
          schema,
          usuarioId,
          renewed[0].rolEfectivo,
        ),
      };
    }

    // Cero filas puede significar propietario distinto, sesión cerrada,
    // timestamp inválido o inactividad. Una única lectura diagnóstica decide el
    // motivo sin separar propietario y estado en consultas distintas.
    return inspectSessionState(tx, schema, sesionId, usuarioId, now, true);
  });
}

async function inspectSessionState(
  database: SessionExecutor,
  schema: SchemaLike,
  sesionId: string,
  usuarioId: string,
  now: Date,
  renewalAttempted: boolean,
): Promise<VerifySessionData> {
  const inactivityBoundary = new Date(
    now.getTime() - INACTIVITY_MS,
  ).toISOString();
  const [session] = await database
    .select({
      usuarioId: schema.sesionUsuario.usuarioId,
      cierre: schema.sesionUsuario.sesionFechaHoraCierre,
      motivoCierre: schema.sesionUsuario.sesionMotivoCierre,
      ultimoAcceso: schema.sesionUsuario.sesionFechaHoraUltimoAcceso,
      rolEfectivo: schema.sesionUsuario.sesionRolEfectivo,
      timestampValido: sql<number>`julianday(${schema.sesionUsuario.sesionFechaHoraUltimoAcceso}) IS NOT NULL`,
      dentroVentana: sql<number>`julianday(${schema.sesionUsuario.sesionFechaHoraUltimoAcceso}) > julianday(${inactivityBoundary})`,
    })
    .from(schema.sesionUsuario)
    .where(eq(schema.sesionUsuario.sesionUsuarioId, sesionId))
    .limit(1);

  if (!session || session.usuarioId !== usuarioId) {
    return { active: false, reason: "sesion-inexistente" };
  }

  if (session.cierre) {
    return { active: false, reason: normalizeReason(session.motivoCierre) };
  }

  if (!session.timestampValido) {
    return { active: false, reason: "sistema" };
  }

  if (session.dentroVentana && renewalAttempted) {
    throw new Error("No fue posible renovar una sesión activa");
  }

  if (session.dentroVentana) {
    return {
      active: true,
      rolEfectivo: await resolveSessionRolEfectivo(
        database,
        schema,
        usuarioId,
        session.rolEfectivo,
      ),
    };
  }

  const closed = await database
    .update(schema.sesionUsuario)
    .set({
      sesionFechaHoraCierre: now.toISOString(),
      sesionMotivoCierre: "inactividad",
    })
    .where(
      and(
        eq(schema.sesionUsuario.sesionUsuarioId, sesionId),
        eq(schema.sesionUsuario.usuarioId, usuarioId),
        isNull(schema.sesionUsuario.sesionFechaHoraCierre),
      ),
    )
    .returning({ id: schema.sesionUsuario.sesionUsuarioId });

  if (closed.length === 0) {
    throw new Error("No fue posible cerrar la sesión expirada");
  }

  const [confirmation] = await database
    .select({
      cierre: schema.sesionUsuario.sesionFechaHoraCierre,
      motivoCierre: schema.sesionUsuario.sesionMotivoCierre,
    })
    .from(schema.sesionUsuario)
    .where(
      and(
        eq(schema.sesionUsuario.sesionUsuarioId, sesionId),
        eq(schema.sesionUsuario.usuarioId, usuarioId),
      ),
    )
    .limit(1);

  if (!confirmation?.cierre || confirmation.motivoCierre !== "inactividad") {
    throw new Error("No se confirmó el cierre por inactividad");
  }

  return { active: false, reason: "inactividad" };
}

/**
 * Helper público de compatibilidad para renovar una sesión abierta. El camino
 * del dispatcher usa validateAndRefreshActiveSession, cuya condición agrega
 * propietario y ventana de inactividad en el mismo UPDATE RETURNING.
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
      sesionMotivoCierre: "manual",
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

async function resolveSessionRolEfectivo(
  database: SessionExecutor,
  schema: SchemaLike,
  usuarioId: string,
  stored: string | null,
): Promise<Role | undefined> {
  if (stored === "dueno" || stored === "trabajador") {
    return stored;
  }

  const [account] = await database
    .select({ usuarioRol: schema.usuario.usuarioRol })
    .from(schema.usuario)
    .where(eq(schema.usuario.usuarioId, usuarioId))
    .limit(1);

  if (!account) {
    return undefined;
  }

  return mapDatabaseRoleToTechnicalRole(account.usuarioRol) ?? undefined;
}

function normalizeReason(motivo: string | null): SessionInactiveReason {
  if (motivo === "inactividad" || motivo === "manual" || motivo === "sistema") {
    return motivo;
  }

  return "sistema";
}

export function createSessionController(
  deps: Partial<SessionDeps> = {},
): RegisteredController<unknown, VerifySessionData | LogoutData> {
  const resolved: SessionDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[4],
    handle: async (_payload, context: ControllerContext) => {
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

      // El guard persistente ya verificó propietario, cierre e inactividad con
      // una sola lectura para el heartbeat. Reconsultar aquí duplicaría T01.
      return controllerSuccess<VerifySessionData>({ active: true });
    },
  };
}

export const sessionController = createSessionController();
