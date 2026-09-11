import { controllers } from "../../shared/controllers";
import { db } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import {
  registerSale,
  SaleBusinessError,
  SaleValidationError,
  validateSaleCart,
  type DbExecutor,
  type SaleRegisterPayload,
} from "./sale-service";
import { notifyDashboardUpdated } from "./dashboard-events";
import { inspectDailyCashRegister, type CashCheckDb } from "./cash-check";
import { searchActiveProducts, type ActiveProductQuery } from "./product-query";
import { AccessDeniedError } from "./auth-context";
import type {
  DailyCashState,
  SaleCartValidationRequest,
  SaleCartValidationResult,
} from "../../shared/sales";

type SaleControllerDependencies = {
  inspectCash: typeof inspectDailyCashRegister;
  register: typeof registerSale;
  searchProducts: typeof searchActiveProducts;
  validateCart: typeof validateSaleCart;
  notify: typeof notifyDashboardUpdated;
};

export function createSaleController(
  dependencies: SaleControllerDependencies = {
    inspectCash: inspectDailyCashRegister,
    register: registerSale,
    searchProducts: searchActiveProducts,
    validateCart: validateSaleCart,
    notify: notifyDashboardUpdated,
  },
): RegisteredController<unknown, unknown> {
  return {
    metadata: controllers[15],
    handle: async (payload, context) => {
      try {
        if (context.channel === "venta:verificar-caja") {
          const state = await dependencies.inspectCash(
            db as unknown as CashCheckDb,
          );
          return controllerSuccess<DailyCashState>(state);
        }

        if (context.channel === "venta:producto") {
          const input = (payload ?? {}) as ActiveProductQuery;
          const products = await dependencies.searchProducts(input);
          const search = input.ean13?.trim() || input.query?.trim();
          if (search && products.length === 0) {
            return controllerError(
              "BUSINESS_RULE",
              "No se encontraron productos activos para la búsqueda.",
              "sale",
            );
          }
          return controllerSuccess(products);
        }

        if (context.channel === "venta:validar-carrito") {
          return controllerSuccess<SaleCartValidationResult>(
            await dependencies.validateCart(
              db as unknown as DbExecutor,
              payload as SaleCartValidationRequest,
            ),
          );
        }

        const cashState = await dependencies.inspectCash(
          db as unknown as CashCheckDb,
        );
        if (cashState.status === "cerrada") {
          return controllerError(
            "BUSINESS_RULE",
            "La caja de este día ya fue cerrada. No es posible registrar nuevas ventas.",
            "sale",
          );
        }
        const receipt = await dependencies.register(
          db as unknown as DbExecutor,
          payload as SaleRegisterPayload,
        );
        dependencies.notify();
        return controllerSuccess(receipt);
      } catch (error) {
        if (error instanceof SaleValidationError) {
          return controllerError("VALIDATION_ERROR", error.message, "sale");
        }

        if (error instanceof SaleBusinessError) {
          return controllerError("BUSINESS_RULE", error.message, "sale");
        }

        if (error instanceof AccessDeniedError) {
          return controllerError("FORBIDDEN", error.message, "sale");
        }

        console.error(error);
        return controllerError(
          "TECHNICAL_ERROR",
          "No fue posible registrar la venta. Intente nuevamente.",
          "sale",
        );
      }
    },
  };
}

export const saleController = createSaleController();
