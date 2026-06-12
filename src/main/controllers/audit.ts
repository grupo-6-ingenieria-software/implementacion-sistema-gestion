import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { registerAuditLog, type DbExecutor } from './sale-service';
import { sql } from 'drizzle-orm';

type AuditRegisterPayload = {
  usuarioId?: string;
  tipoAccion?: string;
  modulo?: string;
  descripcion?: string;
};

export const auditController: RegisteredController = {
  metadata: controllers[3],
  handle: async (payload, context) => {
    if (context.channel === 'auditoria:registrar') {
      const input = payload as AuditRegisterPayload;

      if (
        !input?.usuarioId ||
        !input.tipoAccion?.trim() ||
        !input.modulo?.trim() ||
        !input.descripcion?.trim()
      ) {
        return controllerError(
          'VALIDATION_ERROR',
          'Los datos de auditoría están incompletos.',
          'audit',
        );
      }

      await registerAuditLog(db as unknown as DbExecutor, {
        usuarioId: input.usuarioId,
        tipoAccion: input.tipoAccion.trim(),
        modulo: input.modulo.trim(),
        descripcion: input.descripcion.trim(),
      });

      return controllerSuccess({ registrado: true });
    }

    const rows = await db.all(sql`
      SELECT
        la.log_auditoria_id AS id,
        la.log_fecha_hora AS fechaHora,
        la.log_tipo_accion AS tipoAccion,
        la.log_modulo AS modulo,
        la.log_descripcion AS descripcion
      FROM log_auditoria la
      ORDER BY la.log_fecha_hora DESC
      LIMIT 50
    `);

    return controllerSuccess(rows);
  },
};
