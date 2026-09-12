import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { controllers, type ControllerResponse } from "../../shared/controllers";
import {
  normalizeRut,
  type AttendanceWorkerOption,
} from "../../shared/attendance";
import type { Role } from "../../shared/navigation";
import {
  hasUserFieldErrors,
  normalizeSearchTerm,
  normalizeUserFormPayload,
  normalizeUserListPayload,
  normalizeUserRole,
  normalizeUserStatusChangePayload,
  sortUserList,
  validateUserFormValues,
  type UserFieldErrors,
  type UserFormValues,
  type UserListItem,
  type UserListFilters,
  type UserListResponse,
  type UserMutationResponse,
  type UserStatus,
  type UserStatusChangePayload,
} from "../../shared/users";
import type { ControllerHandler, RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
  type AuthenticatedUser,
} from "./auth-context";
import {
  createTemporaryPasswordRecord,
  defaultDeps as defaultPasswordDeps,
  type PasswordDeps,
} from "./password";

type WorkerDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
    sesionRol?: Role,
  ) => Promise<AuthenticatedUser>;
  changeStatus: (
    payload: UserStatusChangePayload,
    sesionRol?: Role,
  ) => Promise<UserMutationResponse>;
  createWorker: (
    payload: UserFormValues,
    sesionRol?: Role,
  ) => Promise<UserMutationResponse>;
  listWorkers: (filters: UserListFilters) => Promise<UserListItem[]>;
  listActiveWorkers: () => Promise<AttendanceWorkerOption[]>;
  updateWorker: (
    payload: UserFormValues,
    sesionRol?: Role,
  ) => Promise<UserMutationResponse>;
};

type WorkerResponse =
  UserListResponse | UserMutationResponse | AttendanceWorkerOption[];

export function createWorkerController(
  dependencies: WorkerDependencies = workerDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, WorkerResponse> = async (
    payload,
    context,
  ) => {
    try {
      if (context.channel === "trabajador:listar") {
        const usuarioId = normalizeUsuarioId(payload);
        await dependencies.authorize(
          usuarioId,
          ["dueno", "trabajador"],
          normalizeSesionRol(payload),
        );

        const filters = normalizeUserListPayload(payload);
        const workers = await dependencies.listWorkers(filters);

        return {
          ok: true,
          data: {
            users: sortUserList(workers, filters),
          },
        };
      }

      if (context.channel === "trabajador:listar-activos") {
        const usuarioId = normalizeUsuarioId(payload);
        const user = await dependencies.authorize(usuarioId, [
          "dueno",
          "trabajador",
        ]);

        const listContext = payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).contexto
          : undefined;
        if (listContext !== undefined && listContext !== "calendario") {
          return {
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              controllerId: "worker",
              message: "Contexto de consulta de trabajadores no valido.",
            },
          };
        }

        const activeWorkers = await dependencies.listActiveWorkers();

        return {
          ok: true,
          data: listContext === "calendario"
            ? activeWorkers
            : scopeActiveWorkersToUser(activeWorkers, user),
        };
      }

      if (context.channel === "trabajador:registrar") {
        const normalizedPayload = normalizeUserFormPayload(payload);
        const fieldErrors = validateUserFormValues(normalizedPayload);

        if (hasUserFieldErrors(fieldErrors)) {
          return validationError(fieldErrors);
        }

        await dependencies.authorize(
          normalizedPayload.usuarioId,
          ["dueno"],
          normalizeSesionRol(payload),
        );

        return {
          ok: true,
          data: await dependencies.createWorker(
            normalizedPayload,
            normalizeSesionRol(payload),
          ),
        };
      }

      if (context.channel === "trabajador:actualizar") {
        const normalizedPayload = normalizeUserFormPayload(payload);

        await dependencies.authorize(
          normalizedPayload.usuarioId,
          ["dueno"],
          normalizeSesionRol(payload),
        );

        const fieldErrors = validateUserFormValues(normalizedPayload, {
          validateRutFormat: false,
        });

        if (hasUserFieldErrors(fieldErrors)) {
          return validationError(fieldErrors);
        }

        return {
          ok: true,
          data: await dependencies.updateWorker(
            normalizedPayload,
            normalizeSesionRol(payload),
          ),
        };
      }

      if (context.channel === "trabajador:cambiar-estado") {
        const normalizedPayload = normalizeUserStatusChangePayload(payload);

        if (!normalizedPayload.usuarioObjetivoId) {
          return {
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              controllerId: "worker",
              message: "Debe seleccionar un trabajador valido.",
            },
          };
        }

        await dependencies.authorize(
          normalizedPayload.usuarioId,
          ["dueno"],
          normalizeSesionRol(payload),
        );

        return {
          ok: true,
          data: await dependencies.changeStatus(
            normalizedPayload,
            normalizeSesionRol(payload),
          ),
        };
      }

      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "worker",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    } catch (error) {
      const knownError = normalizeWorkerError(error);

      if (knownError) {
        return knownError;
      }

      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "worker",
          message: "No fue posible completar la operacion. Intente nuevamente.",
        },
      };
    }
  };

  return {
    metadata: controllers[20],
    handle,
  };
}

const workerDependencies: WorkerDependencies = {
  authorize: async (usuarioId, allowedRoles, sesionRol) => {
    const { db, schema } = await import("../../db/client");

    return authorizeUser(db, schema, usuarioId, allowedRoles, sesionRol);
  },
  changeStatus,
  createWorker,
  listActiveWorkers,
  listWorkers,
  updateWorker,
};

export const workerController = createWorkerController();

function normalizeSesionRol(payload: unknown): Role | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "__rolSesion" in payload
  ) {
    const rol = (payload as Record<string, unknown>).__rolSesion;

    return rol === "dueno" || rol === "trabajador" ? rol : undefined;
  }

  return undefined;
}

async function listWorkers(
  filters: UserListFilters,
): Promise<UserListItem[]> {
  const { db, schema } = await import("../../db/client");

  return listWorkersWithExecutor(db, schema, filters);
}

export async function listWorkersWithExecutor(
  database: DatabaseLike,
  schema: SchemaLike,
  filters: UserListFilters,
): Promise<UserListItem[]> {
  const termino = filters.search ? normalizeSearchTerm(filters.search) : "";

  const condiciones = [];
  if (filters.estado !== undefined && filters.estado !== "todos") {
    condiciones.push(eq(schema.trabajador.trabajadorEstado, filters.estado));
  }
  if (termino) {
    const patron = `%${termino}%`;
    condiciones.push(
      or(
        sql`lower(${schema.trabajador.trabajadorRut}) LIKE ${patron}`,
        sql`${sinTildes(schema.trabajador.trabajadorNombre)} LIKE ${patron}`,
        sql`${sinTildes(schema.trabajador.trabajadorApellido)} LIKE ${patron}`,
      ),
    );
  }

  const laborales = await database
    .select({
      trabajadorId: schema.trabajador.trabajadorId,
      rut: schema.trabajador.trabajadorRut,
      nombre: schema.trabajador.trabajadorNombre,
      apellido: schema.trabajador.trabajadorApellido,
      telefono: schema.trabajador.trabajadorTelefono,
      correoElectronico: schema.trabajador.trabajadorCorreoElectronico,
      fechaIngreso: schema.trabajador.trabajadorFechaIngreso,
      estado: schema.trabajador.trabajadorEstado,
    })
    .from(schema.trabajador)
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(
      asc(schema.trabajador.trabajadorNombre),
      asc(schema.trabajador.trabajadorApellido),
    );

  const cuentas = await database
    .select({
      trabajadorId: schema.usuario.trabajadorId,
      usuarioId: schema.usuario.usuarioId,
      rol: schema.usuario.usuarioRol,
      ultimoLoginFechaHora: schema.usuario.usuarioUltimoLoginFechaHora,
    })
    .from(schema.usuario)
    .where(
      and(
        laborales.length > 0
          ? inArray(schema.usuario.trabajadorId, laborales.map((fila) => fila.trabajadorId))
          : sql`0 = 1`,
        filters.rol !== undefined && filters.rol !== "todos"
          ? eq(schema.usuario.usuarioRol, filters.rol)
          : undefined,
      ),
    );

  const cuentaPorTrabajador = new Map(
    cuentas.map((cuenta) => [cuenta.trabajadorId, cuenta]),
  );

  return laborales.flatMap((fila) => {
    const cuenta = cuentaPorTrabajador.get(fila.trabajadorId);

    if (!cuenta) {
      return [];
    }

    return [
      {
        usuarioId: cuenta.usuarioId,
        rut: fila.rut,
        nombreCompleto: `${fila.nombre} ${fila.apellido}`.trim(),
        rol: normalizeUserRole(cuenta.rol) ?? "trabajador",
        telefono: fila.telefono,
        correoElectronico: fila.correoElectronico ?? undefined,
        fechaIngreso: fila.fechaIngreso,
        estado: fila.estado as UserStatus,
        ultimoLoginFechaHora: cuenta.ultimoLoginFechaHora ?? undefined,
      },
    ];
  });
}

function sinTildes(columna: AnyColumn) {
  return sql`replace(replace(replace(replace(replace(replace(lower(${columna}), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ñ', 'n')`;
}

async function listActiveWorkers(): Promise<AttendanceWorkerOption[]> {
  const { db, schema } = await import("../../db/client");

  const rows = await db
    .select({
      trabajadorId: schema.trabajador.trabajadorId,
      rut: schema.trabajador.trabajadorRut,
      nombre: schema.trabajador.trabajadorNombre,
      apellido: schema.trabajador.trabajadorApellido,
    })
    .from(schema.trabajador)
    .where(eq(schema.trabajador.trabajadorEstado, "activo"))
    .orderBy(
      asc(schema.trabajador.trabajadorNombre),
      asc(schema.trabajador.trabajadorApellido),
    );

  return rows.map((row) => ({
    trabajadorId: row.trabajadorId,
    rut: row.rut,
    nombreCompleto: `${row.nombre} ${row.apellido}`.trim(),
  }));
}

async function createWorker(
  payload: UserFormValues,
  sesionRol?: Role,
): Promise<UserMutationResponse> {
  const { db, schema } = await import("../../db/client");

  return createWorkerWithExecutor(db, schema, payload, undefined, sesionRol);
}

/**
 * Alta de trabajador (RF + RF58): crea trabajador, usuario, versión inicial y,
 * en la misma transacción, una contraseña temporal de 24h. Devuelve la temporal
 * en texto plano para mostrarla una sola vez al dueño. Exportada para pruebas
 * con una base de datos real.
 */
export async function createWorkerWithExecutor(
  database: DatabaseLike,
  schema: SchemaLike,
  payload: UserFormValues,
  passwordDeps: PasswordDeps = defaultPasswordDeps,
  sesionRol?: Role,
): Promise<UserMutationResponse> {
  let contrasenaTemporal = "";

  await database.transaction(async (tx) => {
    const owner = await authorizeUser(
      tx,
      schema,
      payload.usuarioId,
      ["dueno"],
      sesionRol,
    );
    const existing = await findWorkerByRut(tx, schema, payload.rut);

    if (existing) {
      throw new WorkerError(
        "duplicate-rut",
        "Ya existe un trabajador con ese RUT.",
      );
    }

    const [createdWorker] = await tx
      .insert(schema.trabajador)
      .values({
        trabajadorRut: payload.rut,
        trabajadorNombre: payload.nombreCompleto,
        trabajadorApellido: "",
        trabajadorTelefono: payload.telefono,
        trabajadorCorreoElectronico: payload.correoElectronico || null,
        trabajadorFechaIngreso: todayIsoDate(),
        trabajadorEstado: "activo",
      })
      .returning({ trabajadorId: schema.trabajador.trabajadorId });

    await tx.insert(schema.usuario).values({
      usuarioId: payload.rut,
      usuarioRol: payload.rol,
      trabajadorId: createdWorker.trabajadorId,
    });

    await tx.insert(schema.usuarioVersion).values({
      usuarioVersionNombre: payload.nombreCompleto,
      usuarioVersionRol: payload.rol,
      usuarioId: payload.rut,
    });

    // El nuevo usuario nace con una temporal para que el dueño la entregue de
    // inmediato, sin tener que pasar por el flujo de restablecimiento.
    contrasenaTemporal = await createTemporaryPasswordRecord(
      tx,
      schema,
      { usuarioId: payload.rut, generadaPorUsuarioId: owner.usuarioId },
      passwordDeps,
    );

    await registerAuditLog(tx, schema, {
      tipoAccion: "registro",
      modulo: "trabajadores",
      descripcion: `Trabajador registrado: ${payload.rut}`,
      usuarioId: owner.usuarioId,
    });
  });

  return { usuarioId: payload.rut, contrasenaTemporal };
}

export async function updateWorkerWithExecutor(
  database: DatabaseLike,
  schema: SchemaLike,
  payload: UserFormValues,
  sesionRol?: Role,
): Promise<UserMutationResponse> {
  await database.transaction(async (tx) => {
    const owner = await authorizeUser(
      tx,
      schema,
      payload.usuarioId,
      ["dueno"],
      sesionRol,
    );
    const existing = await findWorkerByRut(tx, schema, payload.rut);

    if (!existing) {
      throw new WorkerError(
        "not-found",
        "No se encontro el trabajador solicitado.",
      );
    }

    const roleChanged = existing.rol !== payload.rol;
    const camposCambiados = camposEditados(existing, payload);

    await tx
      .update(schema.trabajador)
      .set({
        trabajadorNombre: payload.nombreCompleto,
        trabajadorApellido: "",
        trabajadorTelefono: payload.telefono,
        trabajadorCorreoElectronico: payload.correoElectronico || null,
      })
      .where(eq(schema.trabajador.trabajadorId, existing.trabajadorId));

    if (roleChanged) {
      await tx
        .update(schema.usuario)
        .set({ usuarioRol: payload.rol })
        .where(eq(schema.usuario.usuarioId, existing.usuarioId));

      await tx
        .update(schema.usuarioVersion)
        .set({ usuarioVersionFechaHoraVigenciaHasta: new Date().toISOString() })
        .where(
          and(
            eq(schema.usuarioVersion.usuarioId, existing.usuarioId),
            isNull(schema.usuarioVersion.usuarioVersionFechaHoraVigenciaHasta),
          ),
        );

      await tx.insert(schema.usuarioVersion).values({
        usuarioVersionNombre: payload.nombreCompleto,
        usuarioVersionRol: payload.rol,
        usuarioId: existing.usuarioId,
      });
    }

    await registerAuditLog(tx, schema, {
      tipoAccion: "edicion",
      modulo: "trabajadores",
      descripcion: `Trabajador actualizado: ${payload.rut}${camposCambiados.length > 0 ? `; campos: ${camposCambiados.join(", ")}` : ""}`,
      usuarioId: owner.usuarioId,
    });
  });

  return { usuarioId: payload.rut };
}

function camposEditados(
  existing: {
    nombreCompleto: string;
    rol: Role;
    telefono: string;
    correoElectronico: string | null;
  },
  payload: UserFormValues,
): string[] {
  const campos: string[] = [];

  if (existing.nombreCompleto !== payload.nombreCompleto) {
    campos.push("nombre");
  }
  if (existing.rol !== payload.rol) {
    campos.push("rol");
  }
  if (existing.telefono !== payload.telefono) {
    campos.push("telefono");
  }
  if ((existing.correoElectronico ?? "") !== (payload.correoElectronico ?? "")) {
    campos.push("correo");
  }

  return campos;
}

async function updateWorker(
  payload: UserFormValues,
  sesionRol?: Role,
): Promise<UserMutationResponse> {
  const { db, schema } = await import("../../db/client");

  return updateWorkerWithExecutor(db, schema, payload, sesionRol);
}

async function changeStatus(
  payload: UserStatusChangePayload,
  sesionRol?: Role,
): Promise<UserMutationResponse> {
  const { db, schema } = await import("../../db/client");

  await db.transaction(async (tx) => {
    const owner = await authorizeUser(
      tx,
      schema,
      payload.usuarioId,
      ["dueno"],
      sesionRol,
    );
    const existing = await findWorkerByRut(
      tx,
      schema,
      payload.usuarioObjetivoId,
    );

    if (!existing) {
      throw new WorkerError(
        "not-found",
        "No se encontro el trabajador solicitado.",
      );
    }

    await tx
      .update(schema.trabajador)
      .set({ trabajadorEstado: payload.estado })
      .where(eq(schema.trabajador.trabajadorId, existing.trabajadorId));

    await registerAuditLog(tx, schema, {
      tipoAccion: "edicion",
      modulo: "trabajadores",
      descripcion: `Estado de trabajador ${existing.rut} cambiado a ${payload.estado}`,
      usuarioId: owner.usuarioId,
    });
  });

  return { usuarioId: payload.usuarioObjetivoId };
}

async function findWorkerByRut(
  tx: TransactionLike,
  schema: SchemaLike,
  rut: string,
) {
  const [row] = await tx
    .select({
      trabajadorId: schema.trabajador.trabajadorId,
      rut: schema.trabajador.trabajadorRut,
      nombre: schema.trabajador.trabajadorNombre,
      apellido: schema.trabajador.trabajadorApellido,
      telefono: schema.trabajador.trabajadorTelefono,
      correoElectronico: schema.trabajador.trabajadorCorreoElectronico,
      usuarioId: schema.usuario.usuarioId,
      rol: schema.usuario.usuarioRol,
    })
    .from(schema.trabajador)
    .leftJoin(
      schema.usuario,
      eq(schema.usuario.trabajadorId, schema.trabajador.trabajadorId),
    )
    .where(eq(schema.trabajador.trabajadorRut, rut))
    .limit(1);

  if (!row?.usuarioId) {
    return null;
  }

  return {
    trabajadorId: row.trabajadorId,
    rut: row.rut,
    nombreCompleto: `${row.nombre} ${row.apellido}`.trim(),
    telefono: row.telefono,
    correoElectronico: row.correoElectronico,
    usuarioId: row.usuarioId,
    rol: normalizeUserRole(row.rol) ?? "trabajador",
  };
}

/**
 * Conserva el alcance heredado de asistencia cuando no se indica contexto.
 *
 * El dueno necesita la lista completa (p.ej. para asignar turnos), pero un
 * trabajador solo debe ver su propio registro: exponerle la lista completa
 * filtra RUT y nombres del resto del personal (issue #33). El propio registro
 * se identifica por RUT (usuarioId == RUT de la sesion), nunca por posicion.
 * CU28 permite consultar todos los activos mediante contexto: "calendario";
 * ese caso no utiliza este filtro ni cambia los permisos de asistencia.
 */
function scopeActiveWorkersToUser(
  activeWorkers: AttendanceWorkerOption[],
  user: AuthenticatedUser,
): AttendanceWorkerOption[] {
  if (user.role === "dueno") {
    return activeWorkers;
  }

  const ownRut = normalizeRut(user.usuarioId);

  return activeWorkers.filter((worker) => normalizeRut(worker.rut) === ownRut);
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

function validationError(
  fieldErrors: UserFieldErrors,
): ControllerResponse<never> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_ERROR",
      controllerId: "worker",
      fieldErrors,
      message: "Revise los campos marcados antes de continuar.",
    },
  };
}

function normalizeWorkerError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "worker" as const,
        message: error.message,
      },
    };
  }

  if (!(error instanceof WorkerError)) {
    return null;
  }

  if (error.reason === "duplicate-rut") {
    return {
      ok: false as const,
      error: {
        code: "VALIDATION_ERROR" as const,
        controllerId: "worker" as const,
        fieldErrors: { rut: error.message },
        message: "Revise los campos marcados antes de continuar.",
      },
    };
  }

  return {
    ok: false as const,
    error: {
      code: "NOT_FOUND" as const,
      controllerId: "worker" as const,
      message: error.message,
    },
  };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

class WorkerError extends Error {
  constructor(
    readonly reason: "duplicate-rut" | "not-found",
    message: string,
  ) {
    super(message);
  }
}

type SchemaLike = typeof import("../../db/schema");
type DatabaseLike = Pick<
  typeof import("../../db/client").db,
  "select" | "transaction"
>;
type TransactionLike = {
  insert: typeof import("../../db/client").db.insert;
  select: typeof import("../../db/client").db.select;
  update: typeof import("../../db/client").db.update;
};
