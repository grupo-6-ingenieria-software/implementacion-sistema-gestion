import type { IpcMain } from "electron";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { mapDatabaseRoleToTechnicalRole } from "./auth-context";
import { signSessionToken } from "./auth-jwt";
import { controllerError, controllerSuccess } from "./base";
import type { ControllerResponse } from "../../shared/controllers";
import type { LoginData } from "./auth-login";

export const DEBUG_LOGIN_LIST_CHANNEL = "debug:listar-usuarios";
export const DEBUG_LOGIN_AS_CHANNEL = "debug:login-como";

export type DebugUserItem = {
  usuarioId: string;
  nombre: string;
  rol: string;
};

export function isDebugLoginEnabled(): boolean {
  return process.env.HUASCAR_DEBUG_LOGIN === "1";
}

async function listActiveUsers(): Promise<DebugUserItem[]> {
  const rows = await db
    .select({
      usuarioId: schema.usuario.usuarioId,
      usuarioRol: schema.usuario.usuarioRol,
      nombre: schema.trabajador.trabajadorNombre,
      apellido: schema.trabajador.trabajadorApellido,
      estado: schema.trabajador.trabajadorEstado,
    })
    .from(schema.usuario)
    .innerJoin(
      schema.trabajador,
      eq(schema.trabajador.trabajadorId, schema.usuario.trabajadorId),
    );

  return rows
    .filter((row) => row.estado === "activo")
    .map((row) => ({
      usuarioId: row.usuarioId,
      nombre: `${row.nombre} ${row.apellido}`.trim(),
      rol: row.usuarioRol,
    }));
}

async function loginAs(
  payload: unknown,
): Promise<ControllerResponse<LoginData>> {
  const usuarioId =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).usuarioId
      : undefined;

  if (typeof usuarioId !== "string" || !usuarioId.trim()) {
    return controllerError("VALIDATION_ERROR", "Seleccione un usuario.");
  }

  const [user] = await db
    .select({
      usuarioId: schema.usuario.usuarioId,
      usuarioRol: schema.usuario.usuarioRol,
      nombre: schema.trabajador.trabajadorNombre,
      apellido: schema.trabajador.trabajadorApellido,
      estado: schema.trabajador.trabajadorEstado,
    })
    .from(schema.usuario)
    .innerJoin(
      schema.trabajador,
      eq(schema.trabajador.trabajadorId, schema.usuario.trabajadorId),
    )
    .where(eq(schema.usuario.usuarioId, usuarioId.trim()))
    .limit(1);

  if (!user || user.estado !== "activo") {
    return controllerError("NOT_FOUND", "Usuario no encontrado o inactivo.");
  }

  const role = mapDatabaseRoleToTechnicalRole(user.usuarioRol);

  if (!role) {
    return controllerError(
      "TECHNICAL_ERROR",
      "El rol del usuario no es válido.",
    );
  }

  // Sesión real en sesion_usuario para que el latido (auth:verificar-sesion)
  // funcione igual que en un login normal.
  const nowIso = new Date().toISOString();

  const [sesion] = await db
    .insert(schema.sesionUsuario)
    .values({
      sesionFechaHoraInicio: nowIso,
      sesionFechaHoraUltimoAcceso: nowIso,
      usuarioId: user.usuarioId,
    })
    .returning({ sesionId: schema.sesionUsuario.sesionUsuarioId });

  // passwordTemporal=false fuerza la entrada directa al dashboard, sin pasar por
  // el cambio obligatorio de contraseña: el objetivo del modo debug es entrar
  // rápido como cualquier usuario.
  const token = signSessionToken({
    usuarioId: user.usuarioId,
    rol: role,
    usuarioRol: user.usuarioRol,
    passwordTemporal: false,
    sesionId: sesion.sesionId,
  });

  return controllerSuccess<LoginData>({
    token,
    role,
    usuarioId: user.usuarioId,
    usuarioRol: user.usuarioRol,
    trabajadorNombre: `${user.nombre} ${user.apellido}`.trim(),
    passwordChangeRequired: false,
  });
}

/**
 * Monta los handlers IPC de depuración. Sólo debe llamarse cuando
 * isDebugLoginEnabled() es verdadero.
 */
export function registerDebugLogin(ipcMain: IpcMain): void {
  ipcMain.handle(DEBUG_LOGIN_LIST_CHANNEL, async () => {
    try {
      return controllerSuccess(await listActiveUsers());
    } catch {
      return controllerError(
        "DATABASE_ERROR",
        "No se pudieron listar los usuarios.",
      );
    }
  });

  ipcMain.handle(DEBUG_LOGIN_AS_CHANNEL, async (_event, payload) => {
    try {
      return await loginAs(payload);
    } catch {
      return controllerError(
        "DATABASE_ERROR",
        "No fue posible iniciar la sesión de depuración.",
      );
    }
  });

  // eslint-disable-next-line no-console
  console.warn(
    "[debug] Login de depuración ACTIVO (HUASCAR_DEBUG_LOGIN=1). No usar en producción.",
  );
}
