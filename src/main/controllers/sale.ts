import { controllers } from "../../shared/controllers";
import { db } from "../../db/client";
import { NumericRangeError } from "../../shared/numbers";
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
} from "./sale-service";
import { notifyDashboardUpdated } from "./dashboard-events";
import { inspectDailyCashRegister, type CashCheckDb } from "./cash-check";
import { searchActiveProducts, type ActiveProductQuery } from "./product-query";
import { AccessDeniedError } from "./auth-context";
import { demoLog, demoMoney, demoStockSnapshot, logDemoStockChanges } from "./demo-log";
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
          demoLog("RF36", "Verificación de caja", () => ({
            Estado: state.status === "sin_registro" ? "Disponible para primera venta" : state.status,
          }));
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
          if (search) {
            for (const product of products) demoLog("RF36", "Producto encontrado", () => ({
              Producto: product.nombre,
              "EAN-13": product.ean13,
              Stock: product.stockDisponible,
              Precio: demoMoney(product.precioVenta),
            }));
          }
          return controllerSuccess(products);
        }

        if (context.channel === "venta:validar-carrito") {
          const cart = await dependencies.validateCart(
            db as unknown as DbExecutor,
            payload as SaleCartValidationRequest,
          );
          demoLog("RF36", "Carrito validado", () => ({
            ...Object.fromEntries(cart.lines.map((line, index) => [`Producto ${index + 1}`, `${line.cantidad} × ${line.nombre}`])),
            Subtotal: demoMoney(cart.subtotal),
          }));
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
        const previousStock = await demoStockSnapshot();
        const receipt = await dependencies.register(
          db as unknown as DbExecutor,
          request,
          {
            usuarioId: context.claims.usuarioId,
            sesionId: context.claims.sesionId,
            rol: context.claims.rol,
          },
        );
        demoLog("RF36", "Venta confirmada", () => ({
          Venta: receipt.ventaId,
          Responsable: receipt.responsable.nombre,
          Registros: "Venta, pago, detalle, consumo de lotes y auditoría",
        }));
        demoLog("RF36", "Pago confirmado", () => ({
          Método: receipt.metodoPago,
          Total: demoMoney(receipt.total),
          ...(receipt.montoRecibido !== undefined ? { Recibido: demoMoney(receipt.montoRecibido) } : {}),
          ...(receipt.vuelto !== undefined ? { Vuelto: demoMoney(receipt.vuelto) } : {}),
        }));
        await logDemoStockChanges("RF36", previousStock);
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

export const saleController = createSaleController();
