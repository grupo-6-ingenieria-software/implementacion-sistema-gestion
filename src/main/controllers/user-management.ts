import { asc, eq } from 'drizzle-orm';
import { controllers, type ControllerResponse } from '../../shared/controllers';
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
  type AuthenticatedUser,
} from './auth-context';
import { resetPasswordWithExecutor } from './password';

type UserManagementDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  listUsers: () => Promise<UserListItem[]>;
  requestPasswordReset: (
    payload: UserPasswordResetRequestPayload,
  ) => Promise<ControllerResponse<UserPasswordResetRequestResponse>>;
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

        // resetPasswordWithExecutor autoriza al dueño y audita por sí mismo,
        // por lo que delegamos la respuesta (éxito o error) directamente.
        return dependencies.requestPasswordReset(normalizedPayload);
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
): Promise<ControllerResponse<UserPasswordResetRequestResponse>> {
  const { db, schema } = await import('../../db/client');

  // Reutiliza el generador de contraseña temporal de RF58: autoriza al dueño,
  // genera la temporal de 24h, persiste contrasena + contrasena_temporal y audita.
  const result = await resetPasswordWithExecutor(db, schema, {
    usuarioId: payload.usuarioId,
    usuarioObjetivoId: payload.usuarioObjetivoId,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: {
      estado: 'completado',
      contrasenaTemporal: result.data.contrasenaTemporal,
      usuarioObjetivoId: result.data.usuarioObjetivoId,
    },
  };
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
