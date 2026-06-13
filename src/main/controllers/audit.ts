import { db, schema } from '../../db/client';
import { controllers } from '../../shared/controllers';
import type { RegisteredController } from './base';
import { queryAuditLog, registerAuditEvent } from './audit-service';

export const auditController: RegisteredController = {
  metadata: controllers[3],
  handle: async (payload, context) => {
    if (context.channel === 'auditoria:registrar') {
      return registerAuditEvent(db, schema, payload);
    }

    if (context.channel === 'auditoria:consultar') {
      return queryAuditLog(db, schema, payload);
    }

    return {
      ok: false,
      error: {
        code: 'INVALID_CHANNEL',
        controllerId: 'audit',
        message: `Canal IPC no registrado: ${context.channel}`,
      },
    };
  },
};
