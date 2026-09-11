import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { controllers, type ControllerResponse } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  GENERIC_LOGIN_ERROR,
  MAX_LOGIN_ATTEMPTS,
  evaluateLockout,
  formatRemainingLockout,
  type LoginAttempt,
} from "../../shared/auth";
import { db, schema as appSchema } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import {
  mapDatabaseRoleToTechnicalRole,
  registerAuditLog,
} from "./auth-context";
import { signSessionToken, type SessionTokenClaims } from "./auth-jwt";

type SchemaLike = typeof import("../../db/schema");
type LoginExecutor = Pick<typeof db, "select" | "insert" | "update">;

export type LoginPayload = {
  usuario?: string;
  contrasena?: string;
};

export type LoginData = {
  token: string;
  role: Role;
  usuarioId: string;
  usuarioRol: string;
  trabajadorNombre: string;
  passwordChangeRequired: boolean;
};

export type LoginDeps = {
  comparePassword: (plain: string, hash: string) => Promise<boolean>;
  signToken: (claims: SessionTokenClaims) => string;
  now: () => Date;
};

const defaultDeps: LoginDeps = {
  comparePassword: (plain, hash) => bcrypt.compare(plain, hash),
  signToken: signSessionToken,
  now: () => new Date(),
};

export async function authenticateWithExecutor(
  database: LoginExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: LoginDeps = defaultDeps,
): Promise<ControllerResponse<LoginData>> {
  const input = normalizeLoginPayload(payload);

  if (!input) {
    return controllerError(
      "VALIDATION_ERROR",
      "Ingrese usuario y contraseña.",
      "auth-login",
    );
  }

  const now = deps.now();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const usuarioDigitos = input.usuario.replace(/[.-]/g, "").toUpperCase();

  const [user] = await database
    .select({
      usuarioId: schema.usuario.usuarioId,
      usuarioRol: schema.usuario.usuarioRol,
      trabajadorId: schema.usuario.trabajadorId,
    })
    .from(schema.usuario)
    .where(
      sql`upper(replace(replace(${schema.usuario.usuarioId}, '-', ''), '.', '')) = ${usuarioDigitos}`,
    )
    .limit(1);

  // 2. Verificar bloqueo por intentos fallidos previos (e2).
  const previousAttempts = await loadAttempts(
    database,
    schema,
    input.usuario,
    user?.usuarioId,
  );
  const lockout = evaluateLockout(previousAttempts, nowMs);

  if (lockout.locked) {
    // CU56-E2 confirma el bloqueo desde persistencia antes de responder.
    const confirmed = evaluateLockout(
      await loadAttempts(database, schema, input.usuario, user?.usuarioId),
      nowMs,
    );
    return controllerError(
      "FORBIDDEN",
      `Cuenta bloqueada por intentos fallidos. Intente nuevamente en ${formatRemainingLockout(confirmed.remainingMs)}.`,
      "auth-login",
    );
  }

  // 3. Usuario inexistente -> credenciales incorrectas (e1 / e1b).
  if (!user) {
    return recordFailureAndRespond(
      database,
      schema,
      input.usuario,
      undefined,
      previousAttempts,
      nowIso,
      nowMs,
    );
  }

  // 4. Consultar trabajador únicamente después de evaluar el bloqueo.
  const [worker] = await database
    .select()
    .from(schema.trabajador)
    .where(eq(schema.trabajador.trabajadorId, user.trabajadorId))
    .limit(1);
  if (!worker || worker.trabajadorEstado !== "activo") {
    return controllerError("FORBIDDEN", GENERIC_LOGIN_ERROR, "auth-login");
  }

  // 5. Contraseña vigente del usuario.
  const [vigente] = await database
    .select({
      contrasenaId: schema.contrasena.contrasenaId,
      contrasenaHash: schema.contrasena.contrasenaHash,
      esContrasenaTemporal: schema.contrasena.esContrasenaTemporal,
    })
    .from(schema.contrasena)
    .where(eq(schema.contrasena.usuarioId, user.usuarioId))
    .orderBy(desc(schema.contrasena.contrasenaFechaHoraCreacion))
    .limit(1);

  if (!vigente) {
    return recordFailureAndRespond(
      database,
      schema,
      input.usuario,
      user.usuarioId,
      previousAttempts,
      nowIso,
      nowMs,
    );
  }

  const matches = await deps.comparePassword(
    input.contrasena,
    vigente.contrasenaHash,
  );

  if (!matches) {
    return recordFailureAndRespond(
      database,
      schema,
      input.usuario,
      user.usuarioId,
      previousAttempts,
      nowIso,
      nowMs,
    );
  }

  // 6. Si la contraseña vigente es temporal, validar que no haya expirado (RF58).
  if (vigente.esContrasenaTemporal) {
    const [temporal] = await database
      .select({
        expiracion:
          schema.contrasenaTemporal.contrasenaTemporalFechaHoraExpiracion,
      })
      .from(schema.contrasenaTemporal)
      .where(eq(schema.contrasenaTemporal.contrasenaId, vigente.contrasenaId))
      .limit(1);

    if (temporal && nowMs > Date.parse(temporal.expiracion)) {
      return controllerError(
        "BUSINESS_RULE",
        "La contraseña temporal expiró. Solicite al dueño un nuevo restablecimiento.",
        "auth-login",
      );
    }
  }

  const role = mapDatabaseRoleToTechnicalRole(user.usuarioRol);

  if (!role) {
    return controllerError(
      "TECHNICAL_ERROR",
      "El rol del usuario no es válido para iniciar sesión.",
      "auth-login",
    );
  }

  // 7. Registrar intento exitoso.
  await database.insert(schema.intentoLogin).values({
    intentoNombreUsuarioIngresado: input.usuario,
    intentoFechaHora: nowIso,
    intentoExitoso: true,
    usuarioId: user.usuarioId,
  });

  const sesionId = randomUUID();
  // 10. Firmar el JWT con la identidad y el rol.
  const token = deps.signToken({
    usuarioId: user.usuarioId,
    rol: role,
    usuarioRol: user.usuarioRol,
    passwordTemporal: vigente.esContrasenaTemporal,
    sesionId,
  });

  // 8. Crear la sesión.
  await database
    .insert(schema.sesionUsuario)
    .values({
      sesionUsuarioId: sesionId,
      sesionFechaHoraInicio: nowIso,
      sesionFechaHoraUltimoAcceso: nowIso,
      usuarioId: user.usuarioId,
    })
    .returning({ sesionId: schema.sesionUsuario.sesionUsuarioId });

  // 9. Actualizar último login.
  await database
    .update(schema.usuario)
    .set({ usuarioUltimoLoginFechaHora: nowIso })
    .where(eq(schema.usuario.usuarioId, user.usuarioId));

  const trabajadorNombre =
    `${worker.trabajadorNombre} ${worker.trabajadorApellido}`.trim();

  // 11. Auditar el inicio de sesión exitoso (RF57).
  await registerAuditLog(database, schema, {
    descripcion: `Inicio de sesión de ${trabajadorNombre}.`,
    modulo: "autenticacion",
    tipoAccion: "inicio_sesion",
    usuarioId: user.usuarioId,
  });

  return controllerSuccess<LoginData>({
    token,
    role,
    usuarioId: user.usuarioId,
    usuarioRol: user.usuarioRol,
    trabajadorNombre,
    passwordChangeRequired: vigente.esContrasenaTemporal,
  });
}

async function loadAttempts(
  database: LoginExecutor,
  schema: SchemaLike,
  usuario: string,
  usuarioId?: string,
): Promise<LoginAttempt[]> {
  const rows = await database
    .select({
      exitoso: schema.intentoLogin.intentoExitoso,
      fechaHora: schema.intentoLogin.intentoFechaHora,
    })
    .from(schema.intentoLogin)
    .where(
      usuarioId
        ? eq(schema.intentoLogin.usuarioId, usuarioId)
        : sql`upper(replace(replace(${schema.intentoLogin.intentoNombreUsuarioIngresado}, '-', ''), '.', '')) = ${usuario.replace(/[.-]/g, "").toUpperCase()}`,
    );

  return rows.map((row) => ({
    exitoso: Boolean(row.exitoso),
    fechaHora: row.fechaHora,
  }));
}

async function recordFailureAndRespond(
  database: LoginExecutor,
  schema: SchemaLike,
  usuario: string,
  usuarioId: string | undefined,
  previousAttempts: readonly LoginAttempt[],
  nowIso: string,
  nowMs: number,
): Promise<ControllerResponse<LoginData>> {
  await database.insert(schema.intentoLogin).values({
    intentoNombreUsuarioIngresado: usuario,
    intentoFechaHora: nowIso,
    intentoExitoso: false,
    usuarioId: usuarioId ?? null,
  });

  // Re-evaluar el bloqueo incluyendo este intento fallido (e1b).
  const lockout = evaluateLockout(
    [...previousAttempts, { exitoso: false, fechaHora: nowIso }],
    nowMs,
  );

  if (lockout.locked) {
    return controllerError(
      "FORBIDDEN",
      `${GENERIC_LOGIN_ERROR}. Cuenta bloqueada tras ${MAX_LOGIN_ATTEMPTS} intentos fallidos. Intente nuevamente en ${formatRemainingLockout(lockout.remainingMs)}.`,
      "auth-login",
    );
  }

  return controllerError("VALIDATION_ERROR", GENERIC_LOGIN_ERROR, "auth-login");
}

function normalizeLoginPayload(
  payload: unknown,
): { usuario: string; contrasena: string } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as LoginPayload;
  const usuario =
    typeof candidate.usuario === "string" ? candidate.usuario.trim() : "";
  const contrasena =
    typeof candidate.contrasena === "string" ? candidate.contrasena : "";

  if (!usuario || !contrasena) {
    return null;
  }

  return { usuario, contrasena };
}

export function createAuthLoginController(
  deps: Partial<LoginDeps> = {},
): RegisteredController<LoginPayload, LoginData> {
  const resolved: LoginDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[0],
    handle: (payload) =>
      db.transaction((tx) =>
        authenticateWithExecutor(tx, appSchema, payload, resolved),
      ),
  };
}

export const authLoginController = createAuthLoginController();
