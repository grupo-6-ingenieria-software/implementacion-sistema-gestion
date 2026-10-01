import { controllers } from "../../shared/controllers";
import type { SaleCategoryResult } from "../../shared/sales";
import { db } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import {
  loadSaleCategories,
  SaleCategoryValidationError,
  validateSaleCategoryRequest,
  type SaleCategoryDb,
} from "./sale-categories-service";

const metadata = controllers.find((controller) => controller.id === "sale-categories")!;

export function createSaleCategoriesController(
  database: SaleCategoryDb = db as unknown as SaleCategoryDb,
): RegisteredController<unknown, SaleCategoryResult> {
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "venta:por-categoria") {
        return controllerError(
          "INVALID_CHANNEL",
          `Canal IPC no registrado: ${context.channel}`,
          metadata.id,
        );
      }
      if (
        !context.claims?.usuarioId ||
        (context.claims.rol !== "dueno" && context.claims.rol !== "trabajador")
      ) {
        return controllerError(
          "FORBIDDEN",
          "No hay una sesión válida para consultar ventas por categoría.",
          metadata.id,
        );
      }
      try {
        const request = validateSaleCategoryRequest(payload);
        return controllerSuccess(
          await loadSaleCategories(database, request, {
            usuarioId: context.claims.usuarioId,
            rol: context.claims.rol,
          }),
        );
      } catch (error) {
        if (error instanceof SaleCategoryValidationError) {
          return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        }
        console.error(error);
        return controllerError(
          "TECHNICAL_ERROR",
          "No fue posible consultar las ventas por categoría.",
          metadata.id,
        );
      }
    },
  };
}

export const saleCategoriesController = createSaleCategoriesController();
