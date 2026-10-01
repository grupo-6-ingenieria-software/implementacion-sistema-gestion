import { controllers } from "../../shared/controllers";
import { parseProfitabilityPeriod } from "../../shared/category-profitability";
import { AccessDeniedError, authorizeUser } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerContext, type RegisteredController } from "./base";
import { queryCategoryProfitability } from "./category-profitability-service";

export async function loadAuthorizedCategoryProfitability(payload: unknown, context: ControllerContext) {
  if (!context.claims || context.claims.rol !== "dueno") throw new AccessDeniedError();
  const periodo = parseProfitabilityPeriod(payload);
  const { db, schema } = await import("../../db/client");
  const user = await authorizeUser(db, schema, context.claims.usuarioId, ["dueno"], context.claims.rol);
  const report = await queryCategoryProfitability(db, periodo);
  return { report, user };
}

export function createCategoryProfitabilityController(load = loadAuthorizedCategoryProfitability): RegisteredController {
  const metadata = controllers.find((item) => item.id === "category-profitability")!;
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "reporte:rentabilidad-categoria") return controllerError("INVALID_CHANNEL", "Canal de reporte no válido.", metadata.id);
      if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.", metadata.id);
      try {
        const { report } = await load(parseProfitabilityPeriod(payload), context);
        return controllerSuccess(report);
      } catch (error) {
        if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message, metadata.id);
        console.error("[category-profitability]", error);
        return controllerError("DATABASE_ERROR", "No fue posible consultar la rentabilidad por categoría. Intente nuevamente.", metadata.id);
      }
    },
  };
}

export const categoryProfitabilityController = createCategoryProfitabilityController();
