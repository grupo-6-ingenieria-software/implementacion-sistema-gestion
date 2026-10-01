import { findControllerById } from "../../shared/controllers";
import { parseAttendanceReportRequest, type AttendanceReport, type AttendanceReportRequest } from "../../shared/attendance-report";
import { AccessDeniedError, authorizeUser } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerContext, type RegisteredController } from "./base";
import { queryAttendanceReport } from "./attendance-report-service";
import { MonthlyAttendanceError } from "./monthly-attendance-calculation";
import type { DbExecutor } from "./sale-service";

export async function loadAuthorizedAttendanceReport(request: AttendanceReportRequest, context: ControllerContext) {
  if (context.claims?.rol !== "dueno") throw new AccessDeniedError();
  const { db, schema } = await import("../../db/client");
  const user = await authorizeUser(db, schema, context.claims.usuarioId, ["dueno"], context.claims.rol);
  const report = await queryAttendanceReport(db as unknown as DbExecutor, request);
  return { report, user };
}

export function createAttendanceReportController(load = loadAuthorizedAttendanceReport): RegisteredController<unknown, AttendanceReport> {
  const metadata = findControllerById("attendance-report")!;
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "reporte:asistencia") return controllerError("INVALID_CHANNEL", "Canal de reporte no válido.", metadata.id);
      if (context.claims?.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para consultar este reporte.", metadata.id);
      try {
        const { report } = await load(parseAttendanceReportRequest(payload), context);
        return controllerSuccess(report);
      } catch (error) {
        if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message, metadata.id);
        if (error instanceof MonthlyAttendanceError) return controllerError(error.code, error.message, metadata.id);
        console.error("[attendance-report]", error);
        return controllerError("DATABASE_ERROR", "No fue posible consultar el reporte de asistencia. Intente nuevamente.", metadata.id);
      }
    },
  };
}

export const attendanceReportController = createAttendanceReportController();
