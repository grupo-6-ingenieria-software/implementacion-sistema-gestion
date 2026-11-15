import { db, schema } from "../../db/client";
import { findControllerById } from "../../shared/controllers";
import type { RegisteredController } from "./BaseControladorAuxiliar";
import { queryAuditLog, registerAuditEvent } from "./RegistroAuditoriaAuxiliar";

export const auditoriaHandler: RegisteredController = {
  metadata: findControllerById("audit")!,
  handle: async (payload, context) => {
    if (context.channel === "auditoria:registrar") {
      return registerAuditEvent(db, schema, payload);
    }

    if (context.channel === "auditoria:consultar") {
      return queryAuditLog(db, schema, payload, context.claims?.rol);
    }

    return {
      ok: false,
      error: {
        code: "INVALID_CHANNEL",
        controllerId: "audit",
        message: `Canal IPC no registrado: ${context.channel}`,
      },
    };
  },
};
