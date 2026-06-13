import { asc, eq } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import type { Role } from '../../shared/navigation';
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
} from '../../shared/users';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
  type AuthenticatedUser,
} from './auth-context';

type UserManagementDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  listUsers: () => Promise<UserListItem[]>;
  requestPasswordReset: (
    payload: UserPasswordResetRequestPayload,
  ) => Promise<UserPasswordResetRequestResponse>;
};

type UserManagementResponse = UserListResponse | UserPasswordResetRequestResponse;

export function createUserManagementController(
  dependencies: UserManagementDependencies = userManagementDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, UserManagementResponse> = async (
    payload,
    context,
  ) => {
    try {
      if (context.channel === 'usuario:listar') {
        const usuarioId = normalizeUsuarioId(payload);
        await dependencies.authorize(usuarioId, ['dueno']);

        const filters = normalizeUserListPayload(payload);
        const users = await dependencies.listUsers();

        return {
          ok: true,
          data: {
            users: filterAndSortUserList(users, filters),
          },
        };
      }

      if (context.channel === 'usuario:solicitar-restablecimiento') {
        const normalizedPayload = normalizeUserPasswordResetPayload(payload);

        if (!normalizedPayload.usuarioObjetivoId) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              controllerId: 'user-management',
              message: 'Debe seleccionar un usuario valido.',
            },
          };
        }

        await dependencies.authorize(normalizedPayload.usuarioId, ['dueno']);

        return {
          ok: true,
          data: await dependencies.requestPasswordReset(normalizedPayload),
        };
      }

      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'user-management',
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            controllerId: 'user-management',
            message: error.message,
          },
        };
      }

      if (error instanceof UserManagementError) {
        return {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            controllerId: 'user-management',
            message: error.message,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: 'DATABASE_ERROR',
          controllerId: 'user-management',
          message: 'No fue posible completar la operacion. Intente nuevamente.',
        },
      };
    }
  };

  return {
    metadata: controllers[24],
    handle,
  };
}

const userManagementDependencies: UserManagementDependencies = {
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import('../../db/client');

    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  listUsers,
  requestPasswordReset,
};

export const userManagementController = createUserManagementController();

async function listUsers(): Promise<UserListItem[]> {
  const { db, schema } = await import('../../db/client');

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
    rol: normalizeUserRole(row.rol) ?? 'trabajador',
    telefono: row.telefono,
    correoElectronico: row.correoElectronico ?? undefined,
    fechaIngreso: row.fechaIngreso,
    estado: row.estado as UserStatus,
    ultimoLoginFechaHora: row.ultimoLoginFechaHora ?? undefined,
  }));
}

async function requestPasswordReset(
  payload: UserPasswordResetRequestPayload,
): Promise<UserPasswordResetRequestResponse> {
  const { db, schema } = await import('../../db/client');

  await db.transaction(async (tx) => {
    const owner = await authorizeUser(tx, schema, payload.usuarioId, ['dueno']);
    const existing = await findUserById(tx, schema, payload.usuarioObjetivoId);

    if (!existing) {
      throw new UserManagementError('No se encontro el usuario solicitado.');
    }

    await registerAuditLog(tx, schema, {
      tipoAccion: 'restablecimiento',
      modulo: 'usuarios',
      descripcion: `Solicitud de restablecimiento preparada para ${existing.usuarioId}`,
      usuarioId: owner.usuarioId,
    });
  });

  return {
    estado: 'pendiente-auth',
    mensaje:
      'Solicitud validada. La generacion de contrasena temporal queda pendiente del modulo de autenticacion.',
    usuarioObjetivoId: payload.usuarioObjetivoId,
  };
}

async function findUserById(
  tx: TransactionLike,
  schema: SchemaLike,
  usuarioId: string,
) {
  const [row] = await tx
    .select({
      usuarioId: schema.usuario.usuarioId,
    })
    .from(schema.usuario)
    .where(eq(schema.usuario.usuarioId, usuarioId))
    .limit(1);

  return row ?? null;
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

class UserManagementError extends Error {}

type SchemaLike = typeof import('../../db/schema');
type TransactionLike = {
  insert: typeof import('../../db/client').db.insert;
  select: typeof import('../../db/client').db.select;
};
