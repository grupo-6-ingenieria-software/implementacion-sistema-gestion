import { randomInt } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { findControllerById, type ControllerResponse } from "../../shared/controllers";
import {
  TEMP_PASSWORD_LENGTH,
  TEMP_PASSWORD_MS,
  validatePasswordComplexity,
  isTemporaryPasswordValid,
  TEMP_PASSWORD_EXPIRED_MESSAGE,
} from "../../shared/auth";
import type { Role } from "../../shared/navigation";
import {
  filterAndSortUserList,
  normalizeUserListPayload,
  normalizeUserPasswordResetPayload,
  normalizeUserRole,
  type UserListItem,
  type UserListResponse,
  type UserPasswordResetRequestPayload,
  type UserPasswordResetRequestResponse,
  type UserStatus,
} from "../../shared/users";
import { loadCurrentPassword } from "./ContrasenaVigenteAuxiliar";
import { db, schema as appSchema } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type ControllerHandler,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
  type AuthenticatedUser,
} from "./ContextoAutenticacionAuxiliar";

type SchemaLike = typeof import("../../db/schema");
type PasswordExecutor = Pick<typeof db, "transaction">;
type PrepareResetExecutor = Pick<typeof db, "insert" | "select">;
type TempPasswordExecutor = Pick<typeof db, "insert">;

const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export type PasswordDeps = {
  hashPassword: (plain: string) => Promise<string>;
  comparePassword: (plain: string, hash: string) => Promise<boolean>;
  generateTempPassword: () => string;
  now: () => Date;
};

export const defaultDeps: PasswordDeps = {
  hashPassword: (plain) => bcrypt.hash(plain, 10),
  comparePassword: (plain, hash) => bcrypt.compare(plain, hash),
  generateTempPassword: generateTemporaryPassword,
  now: () => new Date(),
};

export async function createTemporaryPasswordRecord(
  executor: TempPasswordExecutor,
  schema: SchemaLike,
  params: { usuarioId: string; generadaPorUsuarioId: string },
  deps: PasswordDeps = defaultDeps,
): Promise<string> {
  const temporal = deps.generateTempPassword();
  const hash = await deps.hashPassword(temporal);
  const now = deps.now();
  const expiracion = new Date(now.getTime() + TEMP_PASSWORD_MS).toISOString();

  const [created] = await executor
    .insert(schema.contrasena)
    .values({
      contrasenaHash: hash,
      contrasenaFechaHoraCreacion: now.toISOString(),
      usuarioId: params.usuarioId,
      generadaPorUsuarioId: params.generadaPorUsuarioId,
    })
    .returning({ contrasenaId: schema.contrasena.contrasenaId });

  await executor.insert(schema.contrasenaTemporal).values({
    contrasenaId: created.contrasenaId,
    contrasenaTemporalFechaHoraExpiracion: expiracion,
  });

  return temporal;
}

export type ChangePasswordPayload = {
  usuarioId?: string;
  contrasenaActual?: string;
  contrasenaNueva?: string;
};

export type ResetPasswordPayload = {
  usuarioId?: string;
  usuarioObjetivoId?: string;
};

export const TARGET_USER_NOT_FOUND_MESSAGE = "Usuario no encontrado.";

export async function prepareResetWithExecutor(
  database: PrepareResetExecutor,
  schema: SchemaLike,
  payload: unknown,
  sessionRole?: Role,
): Promise<ControllerResponse<{ usuarioObjetivoId: string }>> {
  const input = payload as ResetPasswordPayload | null;
  const solicitanteId = normalizeText(input?.usuarioId);
  const objetivoId = normalizeText(input?.usuarioObjetivoId);

  if (!solicitanteId || !objetivoId) {
    return controllerError(
      "VALIDATION_ERROR",
      "Seleccione el usuario al que desea restablecer la contraseña.",
      "password",
    );
  }

  try {
    await authorizeUser(database, schema, solicitanteId, ["dueno"], sessionRole);

    const objetivo = await findTargetUser(database, schema, objetivoId);

    if (!objetivo) {
      return targetUserNotFound();
    }

    return controllerSuccess({ usuarioObjetivoId: objetivo.usuarioId });
  } catch (error) {
    return mapPasswordError(error);
  }
}

export async function changePasswordWithExecutor(
  database: PasswordExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: PasswordDeps = defaultDeps,
): Promise<ControllerResponse<{ cambiada: true }>> {
  const input = payload as ChangePasswordPayload | null;
  const usuarioId = normalizeText(input?.usuarioId);
  const actual =
    typeof input?.contrasenaActual === "string" ? input.contrasenaActual : "";
  const nueva =
    typeof input?.contrasenaNueva === "string" ? input.contrasenaNueva : "";

  if (!usuarioId || !nueva) {
    return controllerError(
      "VALIDATION_ERROR",
      "Ingrese la nueva contraseña.",
      "password",
    );
  }

  try {
    return await database.transaction(async (database) => {
      const user = await authorizeUser(database, schema, usuarioId, [
        "dueno",
        "trabajador",
      ]);

      const vigente = await loadCurrentPassword(database, schema, user.usuarioId);

      if (!vigente) {
        return controllerError(
          "NOT_FOUND",
          "El usuario no tiene una contraseña registrada.",
          "password",
        );
      }

      if (vigente.esContrasenaTemporal && !isTemporaryPasswordValid(vigente.expiracion, deps.now())) {
        return controllerError("BUSINESS_RULE", TEMP_PASSWORD_EXPIRED_MESSAGE, "password");
      }

      if (!vigente.esContrasenaTemporal) {
        if (!actual) {
          return controllerError(
            "VALIDATION_ERROR",
            "Ingrese la contraseña actual y la nueva contraseña.",
            "password",
          );
        }

        const actualOk = await deps.comparePassword(
          actual,
          vigente.contrasenaHash,
        );

        if (!actualOk) {
          return controllerError(
            "VALIDATION_ERROR",
            "La contraseña actual es incorrecta.",
            "password",
          );
        }
      }

      const complexity = validatePasswordComplexity(nueva);

      if (!complexity.valid) {
        return controllerError(
          "VALIDATION_ERROR",
          complexity.message ?? "La nueva contraseña no cumple los requisitos.",
          "password",
        );
      }

      const sameAsCurrent = await deps.comparePassword(
        nueva,
        vigente.contrasenaHash,
      );

      if (sameAsCurrent) {
        return controllerError(
          "BUSINESS_RULE",
          "La nueva contraseña debe ser distinta de la actual.",
          "password",
        );
      }

      const hash = await deps.hashPassword(nueva);

      await database.insert(schema.contrasena).values({
        contrasenaHash: hash,
        contrasenaFechaHoraCreacion: deps.now().toISOString(),
        usuarioId: user.usuarioId,
        generadaPorUsuarioId: user.usuarioId,
      });

      await revokePasswordSessions(database, schema, user.usuarioId, deps.now());

      await registerAuditLog(database, schema, {
        descripcion: `Cambio de contraseña de ${user.trabajadorNombre}.`,
        modulo: "autenticacion",
        tipoAccion: "cambio_password",
        usuarioId: user.usuarioId,
      });

      return controllerSuccess({ cambiada: true });
    });
  } catch (error) {
    return mapPasswordError(error);
  }
}

export async function resetPasswordWithExecutor(
  database: PasswordExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: PasswordDeps = defaultDeps,
  sessionRole?: Role,
  notifySessionsRevoked: (usuarioId: string) => void = () => undefined,
): Promise<
  ControllerResponse<{ contrasenaTemporal: string; usuarioObjetivoId: string }>
> {
  const input = payload as ResetPasswordPayload | null;
  const solicitanteId = normalizeText(input?.usuarioId);
  const objetivoId = normalizeText(input?.usuarioObjetivoId);

  if (!solicitanteId || !objetivoId) {
    return controllerError(
      "VALIDATION_ERROR",
      "Seleccione el usuario al que desea restablecer la contraseña.",
      "password",
    );
  }

  try {
    const result = await database.transaction(async (database) => {
      // Solo el dueño puede restablecer contraseñas (RF59).
      const solicitante = await authorizeUser(database, schema, solicitanteId, [
        "dueno",
      ], sessionRole);

      const objetivo = await findTargetUser(database, schema, objetivoId);

      if (!objetivo) {
        return targetUserNotFound();
      }

      const temporal = await createTemporaryPasswordRecord(
        database,
        schema,
        {
          usuarioId: objetivo.usuarioId,
          generadaPorUsuarioId: solicitante.usuarioId,
        },
        deps,
      );

      await revokePasswordSessions(database, schema, objetivo.usuarioId, deps.now());

      await registerAuditLog(database, schema, {
        descripcion: `Restablecimiento de contraseña para el usuario ${objetivo.usuarioId}.`,
        modulo: "administracion",
        tipoAccion: "restablecer_password",
        usuarioId: solicitante.usuarioId,
      });

      return controllerSuccess({
        contrasenaTemporal: temporal,
        usuarioObjetivoId: objetivo.usuarioId,
      });
    });

    if (result.ok) {
      notifySessionsRevoked(result.data.usuarioObjetivoId);
    }

    return result;
  } catch (error) {
    return mapPasswordError(error);
  }
}

async function findTargetUser(
  database: Pick<typeof db, "select">,
  schema: SchemaLike,
  usuarioObjetivoId: string,
): Promise<{ usuarioId: string } | undefined> {
  const [objetivo] = await database
    .select({ usuarioId: schema.usuario.usuarioId })
    .from(schema.usuario)
    .where(eq(schema.usuario.usuarioId, usuarioObjetivoId))
    .limit(1);

  return objetivo;
}

function targetUserNotFound(): ControllerResponse<never> {
  return controllerError(
    "USUARIO_NO_ENCONTRADO",
    TARGET_USER_NOT_FOUND_MESSAGE,
    "password",
  );
}

async function revokePasswordSessions(
  database: Pick<typeof db, "update">,
  schema: SchemaLike,
  usuarioId: string,
  now: Date,
): Promise<void> {
  await database.update(schema.sesionUsuario).set({
    sesionFechaHoraCierre: now.toISOString(),
    sesionMotivoCierre: "sistema",
  }).where(and(
    eq(schema.sesionUsuario.usuarioId, usuarioId),
    isNull(schema.sesionUsuario.sesionFechaHoraCierre),
  ));
}

export function generateTemporaryPassword(): string {
  let result = "";

  for (let index = 0; index < TEMP_PASSWORD_LENGTH; index += 1) {
    result += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }

  return result;
}

function mapPasswordError(error: unknown): ControllerResponse<never> {
  if (error instanceof AccessDeniedError) {
    return controllerError("FORBIDDEN", error.message, "password");
  }

  return controllerError(
    "DATABASE_ERROR",
    "No fue posible procesar la contraseña. Intente nuevamente.",
    "password",
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function createPasswordHandler(
  deps: Partial<PasswordDeps> = {},
  notifySessionsRevoked: (usuarioId: string) => void = () => undefined,
): RegisteredController {
  const resolved: PasswordDeps = { ...defaultDeps, ...deps };
  const handleUserManagement = createUserManagementHandler();

  return {
    metadata: findControllerById("password")!,
    handle: async (payload, context) => {
      if (context.channel === "auth:cambiar-password") {
        return changePasswordWithExecutor(db, appSchema, payload, resolved);
      }

      if (context.channel === "auth:preparar-restablecimiento") {
        return prepareResetWithExecutor(db, appSchema, payload, context.claims?.rol);
      }

      if (context.channel === "auth:restablecer-password") {
        return resetPasswordWithExecutor(
          db,
          appSchema,
          payload,
          resolved,
          context.claims?.rol,
          notifySessionsRevoked,
        );
      }

      if (
        context.channel === "usuario:listar" ||
        context.channel === "usuario:solicitar-restablecimiento"
      ) {
        return handleUserManagement(payload, context);
      }

      return controllerError(
        "INVALID_CHANNEL",
        `Canal IPC no registrado: ${context.channel}`,
        "password",
      );
    },
  };
}

/**
 * Canales de gestión de usuarios (`usuario:listar` y
 * `usuario:solicitar-restablecimiento`). Antes pertenecían a
 * `C_GestionUsuariosHandler`; el diagrama CU59 los asigna a C_PasswordHandler (C02).
 */
type UserManagementDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
    sessionRole?: Role,
  ) => Promise<AuthenticatedUser>;
  listUsers: () => Promise<UserListItem[]>;
  requestPasswordReset: (
    payload: UserPasswordResetRequestPayload,
    sessionRole?: Role,
  ) => Promise<ControllerResponse<UserPasswordResetRequestResponse>>;
};

type UserManagementResponse =
  UserListResponse | UserPasswordResetRequestResponse;

export function createUserManagementHandler(
  dependencies: UserManagementDependencies = userManagementDependencies,
): ControllerHandler<unknown, UserManagementResponse> {
  return async (payload, context) => {
    try {
      if (context.channel === "usuario:listar") {
        const usuarioId = normalizeUsuarioId(payload);
        await dependencies.authorize(usuarioId, ["dueno"], context.claims?.rol);

        const filters = normalizeUserListPayload(payload);
        const users = await dependencies.listUsers();

        return {
          ok: true,
          data: {
            users: filterAndSortUserList(users, filters),
          },
        };
      }

      if (context.channel === "usuario:solicitar-restablecimiento") {
        const normalizedPayload = normalizeUserPasswordResetPayload(payload);

        if (!normalizedPayload.usuarioObjetivoId) {
          return {
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              controllerId: "password",
              message: "Debe seleccionar un usuario valido.",
            },
          };
        }

        return dependencies.requestPasswordReset(normalizedPayload, context.claims?.rol);
      }

      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "password",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: "password",
            message: error.message,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "password",
          message: "No fue posible completar la operacion. Intente nuevamente.",
        },
      };
    }
  };
}

const userManagementDependencies: UserManagementDependencies = {
  authorize: async (usuarioId, allowedRoles, sessionRole) => {
    const { db, schema } = await import("../../db/client");

    return authorizeUser(db, schema, usuarioId, allowedRoles, sessionRole);
  },
  listUsers,
  requestPasswordReset,
};

async function listUsers(): Promise<UserListItem[]> {
  const { db, schema } = await import("../../db/client");

  const rows = await db
    .select({
      usuarioId: schema.usuario.usuarioId,
      rol: schema.usuario.usuarioRol,
      ultimoLoginFechaHora: schema.usuario.usuarioUltimoLoginFechaHora,
      rut: schema.trabajador.trabajadorRut,
      nombre: schema.trabajador.trabajadorNombre,
      apellido: schema.trabajador.trabajadorApellido,
      telefono: schema.trabajador.trabajadorTelefono,
      correoElectronico: schema.trabajador.trabajadorCorreoElectronico,
      fechaIngreso: schema.trabajador.trabajadorFechaIngreso,
      estado: schema.trabajador.trabajadorEstado,
    })
    .from(schema.usuario)
    .innerJoin(
      schema.trabajador,
      eq(schema.trabajador.trabajadorId, schema.usuario.trabajadorId),
    )
    .orderBy(
      asc(schema.trabajador.trabajadorNombre),
      asc(schema.trabajador.trabajadorApellido),
    );

  return rows.map((row) => ({
    usuarioId: row.usuarioId,
    rut: row.rut,
    nombreCompleto: `${row.nombre} ${row.apellido}`.trim(),
    rol: normalizeUserRole(row.rol) ?? "trabajador",
    telefono: row.telefono,
    correoElectronico: row.correoElectronico ?? undefined,
    fechaIngreso: row.fechaIngreso,
    estado: row.estado as UserStatus,
    ultimoLoginFechaHora: row.ultimoLoginFechaHora ?? undefined,
  }));
}

async function requestPasswordReset(
  payload: UserPasswordResetRequestPayload,
  sessionRole?: Role,
): Promise<ControllerResponse<UserPasswordResetRequestResponse>> {
  const { db, schema } = await import("../../db/client");

  // RF59 comparte la transacción de contraseña, revocación y auditoría con C02.
  const result = await resetPasswordWithExecutor(db, schema, {
    usuarioId: payload.usuarioId,
    usuarioObjetivoId: payload.usuarioObjetivoId,
  }, undefined, sessionRole);

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: {
      estado: "completado",
      contrasenaTemporal: result.data.contrasenaTemporal,
      usuarioObjetivoId: result.data.usuarioObjetivoId,
    },
  };
}

function normalizeUsuarioId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "usuarioId" in payload &&
    typeof payload.usuarioId === "string"
  ) {
    return payload.usuarioId.trim();
  }

  return undefined;
}
