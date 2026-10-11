import log from "electron-log/main";
import { controllers } from "../../shared/controllers";
import { db, schema as appSchema } from "../../db/client";
import type { SaleSearchRequest } from "../../shared/sales";
import type { ReceiptPrintRequest } from "../../shared/receipt-print";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { registerAuditLog } from "./auth-context";
import {
  SaleLookupNotFoundError,
  SaleLookupValidationError,
  loadSaleDetail,
  type SalesHistoryDb,
} from "./sales-history";
import { resolveReceiptPrinter } from "./receipt-printer-settings";
import { createPrinterTransport } from "./receipt-printer-transport";
import {
  ReceiptAuditError,
  ReceiptPrintBusinessError,
  ReceiptPrintFailedError,
  ReceiptPrintValidationError,
  printReceipt,
  type ReceiptPrintDependencies,
} from "./receipt-print-service";

// ImpresionBoletaHandler.
const metadata = controllers.find((controller) => controller.id === "receipt-print")!;

export function createReceiptPrintController(
  deps: ReceiptPrintDependencies,
): RegisteredController<unknown, unknown> {
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "boleta:imprimir") {
        return controllerError(
          "INVALID_CHANNEL",
          `Canal IPC no registrado: ${context.channel}`,
          metadata.id,
        );
      }
      // Defensa en profundidad: el dispatcher ya autorizó, pero una llamada
      // directa sin sesión no debe llegar al servicio.
      if (!context.claims) {
        return controllerError(
          "FORBIDDEN",
          "No hay una sesión válida para realizar esta acción.",
          metadata.id,
        );
      }
      const input = (payload ?? {}) as Record<string, unknown>;
      try {
        return controllerSuccess(
          await printReceipt(
            deps,
            { ventaId: input.ventaId, copia: input.copia } as ReceiptPrintRequest,
            context.claims.usuarioId,
          ),
        );
      } catch (error) {
        if (
          error instanceof ReceiptPrintValidationError ||
          error instanceof SaleLookupValidationError
        ) {
          return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        }
        if (error instanceof SaleLookupNotFoundError) {
          return controllerError("NOT_FOUND", error.message, metadata.id);
        }
        if (error instanceof ReceiptPrintBusinessError) {
          return controllerError("BUSINESS_RULE", error.message, metadata.id);
        }
        if (error instanceof ReceiptAuditError) {
          return controllerError("DATABASE_ERROR", error.message, metadata.id);
        }
        if (error instanceof ReceiptPrintFailedError) {
          return controllerError("TECHNICAL_ERROR", error.message, metadata.id);
        }
        deps.logFailure("Error inesperado al imprimir la boleta", error);
        return controllerError(
          "TECHNICAL_ERROR",
          "No fue posible completar la impresión. Intente nuevamente.",
          metadata.id,
        );
      }
    },
  };
}

export const receiptPrintController = createReceiptPrintController({
  loadSale: (ventaId) =>
    loadSaleDetail(db as unknown as SalesHistoryDb, { ventaId } as SaleSearchRequest),
  printer: resolveReceiptPrinter(),
  transport: createPrinterTransport(),
  audit: (event) => registerAuditLog(db, appSchema, event),
  logFailure: (message, error) => log.error(`[boleta] ${message}`, error),
  now: () => new Date(),
});
