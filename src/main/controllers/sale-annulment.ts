import { controllers } from "../../shared/controllers";
import type {
  SaleAnnulmentRequest,
  SaleAnnulmentResult,
} from "../../shared/sales";
import { db } from "../../db/client";
import { AccessDeniedError } from "./auth-context";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { notifySaleAnnulled } from "./sale-annulment-events";
import {
  annulSale,
  SaleAnnulmentBusinessError,
  SaleAnnulmentNotFoundError,
  SaleAnnulmentValidationError,
} from "./sale-annulment-service";
import type { DbExecutor } from "./sale-service";

const metadata = controllers[26];

type Dependencies = {
  annul: typeof annulSale;
  notify: typeof notifySaleAnnulled;
};

export function createSaleAnnulmentController(
  dependencies: Dependencies = {
    annul: annulSale,
    notify: notifySaleAnnulled,
  },
): RegisteredController<unknown, SaleAnnulmentResult> {
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "venta:anular") {
        return controllerError(
          "INVALID_CHANNEL",
          `Canal IPC no registrado: ${context.channel}`,
          metadata.id,
        );
      }

      try {
        const result = await dependencies.annul(
          db as unknown as DbExecutor,
          (payload ?? {}) as SaleAnnulmentRequest,
        );
        dependencies.notify(result);
        return controllerSuccess(result);
      } catch (error) {
        if (error instanceof SaleAnnulmentValidationError) {
          return controllerError(
            "VALIDATION_ERROR",
            error.message,
            metadata.id,
          );
        }
        if (error instanceof SaleAnnulmentNotFoundError) {
          return controllerError("NOT_FOUND", error.message, metadata.id);
        }
        if (error instanceof SaleAnnulmentBusinessError) {
          return controllerError("BUSINESS_RULE", error.message, metadata.id);
        }
        if (error instanceof AccessDeniedError) {
          return controllerError("FORBIDDEN", error.message, metadata.id);
        }

        console.error(error);
        return controllerError(
          "TECHNICAL_ERROR",
          "No fue posible anular la venta. Intente nuevamente.",
          metadata.id,
        );
      }
    },
  };
}

export const saleAnnulmentController = createSaleAnnulmentController();
