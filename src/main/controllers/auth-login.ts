import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { sql } from 'drizzle-orm';

type LoginPayload = {
  role?: 'dueno' | 'trabajador';
};

type LoginResponse = {
  role: 'dueno' | 'trabajador';
  usuarioId: string;
  trabajadorNombre: string;
  usuarioRol: string;
};

export const authLoginController: RegisteredController<LoginPayload, LoginResponse> = {
  metadata: controllers[0],
  handle: async (payload) => {
    const requestedRole = payload?.role;

    if (requestedRole !== 'dueno' && requestedRole !== 'trabajador') {
      return controllerError(
        'VALIDATION_ERROR',
        'Seleccione un rol válido para iniciar sesión.',
        'auth-login',
      );
    }

    const roleCondition =
      requestedRole === 'dueno'
        ? sql`u.usuario_rol IN ('dueño', 'dueÃ±o')`
        : sql`u.usuario_rol IN ('cajero', 'reponedor')`;

    const rows = await db.all<{
      usuarioId: string;
      usuarioRol: string;
      trabajadorNombre: string;
    }>(sql`
      SELECT
        u.usuario_id AS usuarioId,
        u.usuario_rol AS usuarioRol,
        t.trabajador_nombre || ' ' || t.trabajador_apellido AS trabajadorNombre
      FROM usuario u
      INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
      WHERE ${roleCondition}
        AND t.trabajador_estado = 'activo'
      ORDER BY t.trabajador_id ASC
      LIMIT 1
    `);

    const user = rows[0];

    if (!user) {
      return controllerError(
        'BUSINESS_RULE',
        'No existe un trabajador activo para el rol seleccionado.',
        'auth-login',
      );
    }

    await db.run(sql`
      UPDATE usuario
      SET usuario_ultimo_login_fecha_hora = ${new Date().toISOString()}
      WHERE usuario_id = ${user.usuarioId}
    `);

    return controllerSuccess({
      role: requestedRole,
      usuarioId: user.usuarioId,
      trabajadorNombre: user.trabajadorNombre,
      usuarioRol: user.usuarioRol,
    });
  },
};
