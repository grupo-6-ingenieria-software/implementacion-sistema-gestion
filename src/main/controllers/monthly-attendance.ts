import { findControllerById } from "../../shared/controllers";
import { parseMonthlyAttendanceRequest, type MonthlyAttendanceRequest, type MonthlyAttendanceSummary } from "../../shared/monthly-attendance";
import { AccessDeniedError, authorizeUser } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerContext, type RegisteredController } from "./base";
import { MonthlyAttendanceError, queryMonthlyAttendance } from "./monthly-attendance-service";
import type { DbExecutor } from "./sale-service";

async function loadAuthorizedMonthlyAttendance(request: MonthlyAttendanceRequest, context: ControllerContext): Promise<MonthlyAttendanceSummary> {
  if (!context.claims || context.claims.rol !== "dueno") throw new AccessDeniedError();
  const { db, schema } = await import("../../db/client");
  await authorizeUser(db, schema, context.claims.usuarioId, ["dueno"], context.claims.rol);
  return queryMonthlyAttendance(db as unknown as DbExecutor, request);
}

export function createMonthlyAttendanceController(load = loadAuthorizedMonthlyAttendance): RegisteredController<unknown, MonthlyAttendanceSummary> {
  const metadata = findControllerById("attendance-monthly-summary")!;
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "asistencia:resumen-mensual") return controllerError("INVALID_CHANNEL", "Canal de resumen de asistencia no válido.", metadata.id);
      if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para consultar el resumen de asistencia.", metadata.id);
      try {
        return controllerSuccess(await load(parseMonthlyAttendanceRequest(payload), context));
      } catch (error) {
        if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message, metadata.id);
        if (error instanceof MonthlyAttendanceError) return controllerError(error.code, error.message, metadata.id);
        console.error("No fue posible consultar el resumen de asistencia", error);
        return controllerError("DATABASE_ERROR", "No fue posible consultar el resumen de asistencia. Intente nuevamente.", metadata.id);
      }
    },
  };
}

export const monthlyAttendanceController = createMonthlyAttendanceController();
