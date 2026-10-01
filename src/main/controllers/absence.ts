import { db } from "../../db/client";
import { findControllerById } from "../../shared/controllers";
import type { AbsenceResult } from "../../shared/absence";
import { controllerError, controllerSuccess, type RegisteredController } from "./base";
import { AbsenceError, registerAbsence } from "./absence-service";
import type { DbExecutor } from "./sale-service";

export function createAbsenceController(
  register: typeof registerAbsence = registerAbsence,
  database: DbExecutor = db as unknown as DbExecutor,
): RegisteredController<unknown, AbsenceResult> {
  return {
    metadata: findControllerById("absence")!,
    handle: async (payload, context) => {
      if (context.channel !== "ausencia:registrar") {
        return controllerError("INVALID_CHANNEL", "Canal de ausencia no válido.", "absence");
      }
      if (!context.claims || context.claims.rol !== "dueno") {
        return controllerError("FORBIDDEN", "No tiene permiso para registrar ausencias.", "absence");
      }
      try {
        return controllerSuccess(await register(database, payload, context.claims));
      } catch (error) {
        if (error instanceof AbsenceError) {
          return { ok: false, error: { code: error.code, message: error.message,
            controllerId: "absence", fieldErrors: error.fieldErrors } };
        }
        console.error("No fue posible registrar la ausencia", error);
        return controllerError("TECHNICAL_ERROR", "No fue posible registrar la ausencia. Intente nuevamente.", "absence");
      }
    },
  };
}

export const absenceController = createAbsenceController();
