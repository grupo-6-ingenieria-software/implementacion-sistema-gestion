import { eq } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import type { Role } from '../../shared/navigation';
import { db, schema } from '../../db/client';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import { mapDatabaseRoleToTechnicalRole } from './auth-context';

type LoginPayload = {
  role?: Role;
};

type LoginResponse = {
  role: Role;
  trabajadorNombre: string;
  usuarioId: string;
  usuarioRol: string;
};

export const authLoginController: RegisteredController<
  LoginPayload,
  LoginResponse
> = {
  metadata: controllers[0],
  handle: async (payload) => {
    const requestedRole = normalizeLoginPayload(payload).role;

    if (requestedRole !== 'dueno' && requestedRole !== 'trabajador') {
      return controllerError(
        'VALIDATION_ERROR',
        'Seleccione un rol valido para iniciar sesion.',
        'auth-login',
      );
    }

    const activeUsers = await db
      .select({
        usuarioId: schema.usuario.usuarioId,
        usuarioRol: schema.usuario.usuarioRol,
        trabajadorNombre: schema.trabajador.trabajadorNombre,
        trabajadorApellido: schema.trabajador.trabajadorApellido,
      })
      .from(schema.usuario)
      .innerJoin(
        schema.trabajador,
        eq(schema.trabajador.trabajadorId, schema.usuario.trabajadorId),
      )
      .where(eq(schema.trabajador.trabajadorEstado, 'activo'))
      .orderBy(schema.trabajador.trabajadorId)
      .limit(20);

    const user = activeUsers.find(
      (candidate) =>
        mapDatabaseRoleToTechnicalRole(candidate.usuarioRol) === requestedRole,
    );

    if (!user) {
      return controllerError(
        'FORBIDDEN',
        'No existe un trabajador activo para el rol seleccionado.',
        'auth-login',
      );
    }

    const role = mapDatabaseRoleToTechnicalRole(user.usuarioRol);

    if (role !== requestedRole) {
      return controllerError(
        'FORBIDDEN',
        'El usuario encontrado no coincide con el rol solicitado.',
        'auth-login',
      );
    }

    await db
      .update(schema.usuario)
      .set({ usuarioUltimoLoginFechaHora: new Date().toISOString() })
      .where(eq(schema.usuario.usuarioId, user.usuarioId));

    return controllerSuccess<LoginResponse>({
      role,
      usuarioId: user.usuarioId,
      usuarioRol: user.usuarioRol,
      trabajadorNombre:
        `${user.trabajadorNombre} ${user.trabajadorApellido}`.trim(),
    });
  },
};

function normalizeLoginPayload(payload: unknown): LoginPayload {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'role' in payload &&
    typeof payload.role === 'string'
  ) {
    return { role: payload.role as Role };
  }

  return {};
}
