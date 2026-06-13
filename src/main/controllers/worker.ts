import { and, asc, eq, isNull } from 'drizzle-orm';
import { controllers, type ControllerResponse } from '../../shared/controllers';
import type { Role } from '../../shared/navigation';
import {
  filterAndSortUserList,
  hasUserFieldErrors,
  normalizeUserFormPayload,
  normalizeUserListPayload,
  normalizeUserRole,
  normalizeUserStatusChangePayload,
  validateUserFormValues,
  type UserFieldErrors,
  type UserFormValues,
  type UserListItem,
  type UserListResponse,
  type UserMutationResponse,
  type UserStatus,
  type UserStatusChangePayload,
} from '../../shared/users';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
  type AuthenticatedUser,
} from './auth-context';
import {
  createTemporaryPasswordRecord,
  defaultDeps as defaultPasswordDeps,
  type PasswordDeps,
} from './password';

type WorkerDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  changeStatus: (payload: UserStatusChangePayload) => Promise<UserMutationResponse>;
  createWorker: (payload: UserFormValues) => Promise<UserMutationResponse>;
  listWorkers: () => Promise<UserListItem[]>;
  listActiveWorkers: () => Promise<UserListItem[]>;
  updateWorker: (payload: UserFormValues) => Promise<UserMutationResponse>;
};

type WorkerResponse = UserListResponse | UserMutationResponse | UserListItem[];

export function createWorkerController(
  dependencies: WorkerDependencies = workerDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, WorkerResponse> = async (
    payload,
    context,
  ) => {
    try {
      if (context.channel === 'trabajador:listar') {
        const usuarioId = normalizeUsuarioId(payload);
        await dependencies.authorize(usuarioId, ['dueno']);

        const filters = normalizeUserListPayload(payload);
        const workers = await dependencies.listWorkers();

        return {
          ok: true,
          data: {
            users: filterAndSortUserList(workers, filters),
          },
        };
      }

      if (context.channel === 'trabajador:listar-activos') {
        const usuarioId = normalizeUsuarioId(payload);
        await dependencies.authorize(usuarioId, ['dueno', 'trabajador']);

        return {
          ok: true,
          data: await dependencies.listActiveWorkers(),
        };
      }

      if (context.channel === 'trabajador:registrar') {
        const normalizedPayload = normalizeUserFormPayload(payload);
        const fieldErrors = validateUserFormValues(normalizedPayload);

        if (hasUserFieldErrors(fieldErrors)) {
          return validationError(fieldErrors);
        }

        await dependencies.authorize(normalizedPayload.usuarioId, ['dueno']);

        return {
          ok: true,
          data: await dependencies.createWorker(normalizedPayload),
        };
      }

      if (context.channel === 'trabajador:actualizar') {
        const normalizedPayload = normalizeUserFormPayload(payload);
        const fieldErrors = validateUserFormValues(normalizedPayload, {
          validateRutFormat: false,
        });

        if (hasUserFieldErrors(fieldErrors)) {
          return validationError(fieldErrors);
        }

        await dependencies.authorize(normalizedPayload.usuarioId, ['dueno']);

        return {
          ok: true,
          data: await dependencies.updateWorker(normalizedPayload),
        };
      }

      if (context.channel === 'trabajador:cambiar-estado') {
        const normalizedPayload = normalizeUserStatusChangePayload(payload);

        if (!normalizedPayload.usuarioObjetivoId) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              controllerId: 'worker',
              message: 'Debe seleccionar un trabajador valido.',
            },
          };
        }

        await dependencies.authorize(normalizedPayload.usuarioId, ['dueno']);

        return {
          ok: true,
          data: await dependencies.changeStatus(normalizedPayload),
        };
      }

      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'worker',
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
          code: 'DATABASE_ERROR',
          controllerId: 'worker',
          message: 'No fue posible completar la operacion. Intente nuevamente.',
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
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import('../../db/client');

    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  changeStatus,
  createWorker,
  listActiveWorkers,
  listWorkers,
  updateWorker,
};

export const workerController = createWorkerController();

async function listWorkers(): Promise<UserListItem[]> {
  const { db, schema } = await import('../../db/client');

  return mapWorkerRows(
    await db
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
      .from(schema.trabajador)
      .innerJoin(
        schema.usuario,
        eq(schema.usuario.trabajadorId, schema.trabajador.trabajadorId),
      )
      .orderBy(
        asc(schema.trabajador.trabajadorNombre),
        asc(schema.trabajador.trabajadorApellido),
      ),
  );
}

async function listActiveWorkers(): Promise<UserListItem[]> {
  const { db, schema } = await import('../../db/client');

  return mapWorkerRows(
    await db
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
      .from(schema.trabajador)
      .innerJoin(
        schema.usuario,
        eq(schema.usuario.trabajadorId, schema.trabajador.trabajadorId),
      )
      .where(eq(schema.trabajador.trabajadorEstado, 'activo'))
      .orderBy(
        asc(schema.trabajador.trabajadorNombre),
        asc(schema.trabajador.trabajadorApellido),
      ),
  );
}

async function createWorker(
  payload: UserFormValues,
): Promise<UserMutationResponse> {
  const { db, schema } = await import('../../db/client');

  return createWorkerWithExecutor(db, schema, payload);
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
): Promise<UserMutationResponse> {
  let contrasenaTemporal = '';

  await database.transaction(async (tx) => {
    const owner = await authorizeUser(tx, schema, payload.usuarioId, ['dueno']);
    const existing = await findWorkerByRut(tx, schema, payload.rut);

    if (existing) {
      throw new WorkerError('duplicate-rut', 'Ya existe un trabajador con ese RUT.');
    }

    const [createdWorker] = await tx
      .insert(schema.trabajador)
      .values({
        trabajadorRut: payload.rut,
        trabajadorNombre: payload.nombreCompleto,
        trabajadorApellido: '',
        trabajadorTelefono: payload.telefono,
        trabajadorCorreoElectronico: payload.correoElectronico || null,
        trabajadorFechaIngreso: todayIsoDate(),
        trabajadorEstado: 'activo',
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
      tipoAccion: 'registro',
      modulo: 'trabajadores',
      descripcion: `Trabajador registrado: ${payload.rut}`,
      usuarioId: owner.usuarioId,
    });
  });

  return { usuarioId: payload.rut, contrasenaTemporal };
}

async function updateWorker(
  payload: UserFormValues,
): Promise<UserMutationResponse> {
  const { db, schema } = await import('../../db/client');

  await db.transaction(async (tx) => {
    const owner = await authorizeUser(tx, schema, payload.usuarioId, ['dueno']);
    const existing = await findWorkerByRut(tx, schema, payload.rut);

    if (!existing) {
      throw new WorkerError('not-found', 'No se encontro el trabajador solicitado.');
    }

    const nameChanged = existing.nombreCompleto !== payload.nombreCompleto;
    const roleChanged = existing.rol !== payload.rol;

    await tx
      .update(schema.trabajador)
      .set({
        trabajadorNombre: payload.nombreCompleto,
        trabajadorApellido: '',
        trabajadorTelefono: payload.telefono,
        trabajadorCorreoElectronico: payload.correoElectronico || null,
      })
      .where(eq(schema.trabajador.trabajadorId, existing.trabajadorId));

    await tx
      .update(schema.usuario)
      .set({ usuarioRol: payload.rol })
      .where(eq(schema.usuario.usuarioId, existing.usuarioId));

    if (nameChanged || roleChanged) {
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
      tipoAccion: 'edicion',
      modulo: 'trabajadores',
      descripcion: `Trabajador actualizado: ${payload.rut}`,
      usuarioId: owner.usuarioId,
    });
  });

  return { usuarioId: payload.rut };
}

async function changeStatus(
  payload: UserStatusChangePayload,
): Promise<UserMutationResponse> {
  const { db, schema } = await import('../../db/client');

  await db.transaction(async (tx) => {
    const owner = await authorizeUser(tx, schema, payload.usuarioId, ['dueno']);
    const existing = await findWorkerByRut(tx, schema, payload.usuarioObjetivoId);

    if (!existing) {
      throw new WorkerError('not-found', 'No se encontro el trabajador solicitado.');
    }

    await tx
      .update(schema.trabajador)
      .set({ trabajadorEstado: payload.estado })
      .where(eq(schema.trabajador.trabajadorId, existing.trabajadorId));

    await registerAuditLog(tx, schema, {
      tipoAccion: 'edicion',
      modulo: 'trabajadores',
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
    usuarioId: row.usuarioId,
    rol: normalizeUserRole(row.rol) ?? 'trabajador',
  };
}

function mapWorkerRows(
  rows: Array<{
    correoElectronico: string | null;
    estado: string;
    fechaIngreso: string;
    nombre: string;
    apellido: string;
    rol: string;
    rut: string;
    telefono: string;
    ultimoLoginFechaHora: string | null;
    usuarioId: string;
  }>,
): UserListItem[] {
  return rows.map((row) => ({
    usuarioId: row.usuarioId,
    rut: row.rut,
    nombreCompleto: `${row.nombre} ${row.apellido}`.trim(),
    rol: normalizeUserRole(row.rol) ?? 'trabajador',
    telefono: row.telefono,
    correoElectronico: row.correoElectronico ?? undefined,
    fechaIngreso: row.fechaIngreso,
    estado: row.estado as UserStatus,
    ultimoLoginFechaHora: row.ultimoLoginFechaHora ?? undefined,
  }));
}

function normalizeUsuarioId(payload: unknown): string | undefined {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'usuarioId' in payload &&
    typeof payload.usuarioId === 'string'
  ) {
    return payload.usuarioId.trim();
  }

  return undefined;
}

function validationError(fieldErrors: UserFieldErrors): ControllerResponse<never> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      controllerId: 'worker',
      fieldErrors,
      message: 'Revise los campos marcados antes de continuar.',
    },
  };
}

function normalizeWorkerError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: 'FORBIDDEN' as const,
        controllerId: 'worker' as const,
        message: error.message,
      },
    };
  }

  if (!(error instanceof WorkerError)) {
    return null;
  }

  if (error.reason === 'duplicate-rut') {
    return {
      ok: false as const,
      error: {
        code: 'VALIDATION_ERROR' as const,
        controllerId: 'worker' as const,
        fieldErrors: { rut: error.message },
        message: 'Revise los campos marcados antes de continuar.',
      },
    };
  }

  return {
    ok: false as const,
    error: {
      code: 'NOT_FOUND' as const,
      controllerId: 'worker' as const,
      message: error.message,
    },
  };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

class WorkerError extends Error {
  constructor(
    readonly reason: 'duplicate-rut' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

type SchemaLike = typeof import('../../db/schema');
type DatabaseLike = Pick<typeof import('../../db/client').db, 'transaction'>;
type TransactionLike = {
  insert: typeof import('../../db/client').db.insert;
  select: typeof import('../../db/client').db.select;
  update: typeof import('../../db/client').db.update;
};
