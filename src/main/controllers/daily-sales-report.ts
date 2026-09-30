import { db } from "../../db/client";
import { controllers } from "../../shared/controllers";
import type { DailySalesReport, DailySalesReportRequest } from "../../shared/reports";
import { controllerError, controllerSuccess, type RegisteredController } from "./base";
import {
  DailySalesReportValidationError,
  loadDailySalesReport,
} from "./daily-sales-report-service";

export type DailySalesReportDependencies = {
  load: (fecha: string) => Promise<DailySalesReport>;
};

export function createDailySalesReportController(
  dependencies: DailySalesReportDependencies = {
    load: (fecha) => loadDailySalesReport(db, fecha),
  },
): RegisteredController {
  const metadata = controllers.find((item) => item.id === "daily-sales-report")!;
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "reporte:ventas-diarias") {
        return controllerError("INVALID_CHANNEL", "Canal de reporte inválido.", metadata.id);
      }
      if (context.claims?.rol !== "dueno") {
        return controllerError("FORBIDDEN", "No tiene permiso para consultar este reporte.", metadata.id);
      }
      try {
        const fecha = (payload as Partial<DailySalesReportRequest> | null)?.fecha;
        if (typeof fecha !== "string") {
          return controllerError("VALIDATION_ERROR", "Ingrese una fecha válida.", metadata.id);
        }
        return controllerSuccess(await dependencies.load(fecha));
      } catch (error) {
        if (error instanceof DailySalesReportValidationError) {
          return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        }
        console.error("[daily-sales-report] Error:", error);
        return controllerError("DATABASE_ERROR", "No fue posible consultar el reporte.", metadata.id);
      }
    },
  };
}

export const dailySalesReportController = createDailySalesReportController();
