import { findControllerById } from "../../shared/controllers";
import { db } from "../../db/client";
import { NumericRangeError } from "../../shared/numbers";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import {
  registerSale,
  SaleBusinessError,
  SaleValidationError,
  validateSaleCart,
  type DbExecutor,
} from "./RegistroVentaAuxiliar";
import { notifyDashboardUpdated } from "./EventosDashboardAuxiliar";
import { inspectDailyCashRegister, type CashCheckDb } from "./VerificacionCajaHandler";
import { searchActiveProducts, type ActiveProductQuery } from "./ConsultaProductoHandler";
import { AccessDeniedError } from "./ContextoAutenticacionAuxiliar";
import { traceDemoCall } from "../demo-trace";
import type {
  DailyCashState,
  SaleCartValidationRequest,
  SaleCartValidationResult,
  SaleReceipt,
  SaleRegisterRequest,
} from "../../shared/sales";

type SaleControllerDependencies = {
  inspectCash: typeof inspectDailyCashRegister;
  register: typeof registerSale;
  searchProducts: typeof searchActiveProducts;
  validateCart: typeof validateSaleCart;
  notify: typeof notifyDashboardUpdated;
};

export function createVentaHandler(
  dependencies: SaleControllerDependencies = {
    inspectCash: inspectDailyCashRegister,
    register: registerSale,
    searchProducts: searchActiveProducts,
    validateCart: validateSaleCart,
    notify: notifyDashboardUpdated,
  },
): RegisteredController<unknown, unknown> {
  return {
    metadata: findControllerById("sale")!,
    handle: async (payload, context) => {
      try {
        if (context.channel === "venta:verificar-caja") {
          const state = await traceDemoCall("C_VerificacionCajaHandler", "Verificar caja abierta del día", () => dependencies.inspectCash(
            db as unknown as CashCheckDb,
          ));
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
          const cart = await dependencies.validateCart(
            db as unknown as DbExecutor,
            payload as SaleCartValidationRequest,
          );
          return controllerSuccess<SaleCartValidationResult>(cart);
        }

        if (!context.claims) {
          throw new AccessDeniedError(
            "No hay una sesión válida para registrar la venta.",
          );
        }
        const input = (payload ?? {}) as SaleRegisterRequest;
        const request: SaleRegisterRequest = {
          items: input.items,
          metodoPago: input.metodoPago,
          montoRecibido: input.montoRecibido,
          descuento: input.descuento,
        };
        const receipt = await dependencies.register(
          db as unknown as DbExecutor,
          request,
          {
            usuarioId: context.claims.usuarioId,
            sesionId: context.claims.sesionId,
            rol: context.claims.rol,
          },
        );
        dependencies.notify();
        return controllerSuccess<SaleReceipt>(receipt);
      } catch (error) {
        if (error instanceof SaleValidationError) {
          return controllerError("VALIDATION_ERROR", error.message, "sale");
        }

        if (error instanceof SaleBusinessError || error instanceof NumericRangeError) {
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

export const ventaHandler = createVentaHandler();
