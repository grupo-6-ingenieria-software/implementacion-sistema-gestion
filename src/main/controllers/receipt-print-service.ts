import {
  ANNULLED_REPRINT_MESSAGE,
  PRINT_FAILED_MESSAGE,
  RECEIPT_COLUMNS,
  describePrinterTarget,
  type PrinterConfig,
  type ReceiptPrintRequest,
  type ReceiptPrintResult,
} from "../../shared/receipt-print";
import { isValidSaleId, type SaleDetail } from "../../shared/sales";
import { composeReceipt, encodeEscPos } from "./receipt-escpos";
import type { PrinterTransport } from "./receipt-printer-transport";

export class ReceiptPrintValidationError extends Error {}
export class ReceiptPrintBusinessError extends Error {}
export class ReceiptPrintFailedError extends Error {}
export class ReceiptAuditError extends Error {}

export type ReceiptAuditEvent = {
  descripcion: string;
  modulo: string;
  tipoAccion: string;
  usuarioId: string;
};

export type ReceiptPrintDependencies = {
  loadSale: (ventaId: string) => Promise<SaleDetail>;
  printer: PrinterConfig;
  transport: PrinterTransport;
  audit: (event: ReceiptAuditEvent) => Promise<void>;
  logFailure: (message: string, error: unknown) => void;
  now: () => Date;
};

// La boleta se compone en Main desde la venta registrada; nunca
// desde datos enviados por la vista. Imprimir no modifica la venta.
export async function printReceipt(
  deps: ReceiptPrintDependencies,
  request: ReceiptPrintRequest,
  usuarioId: string,
): Promise<ReceiptPrintResult> {
  if (!isValidSaleId(request?.ventaId)) {
    throw new ReceiptPrintValidationError(
      "Ingrese un número de venta válido en formato UUID.",
    );
  }
  const copia = request.copia === true;
  const sale = await deps.loadSale(request.ventaId.trim());
  if (sale.estado === "anulada") {
    throw new ReceiptPrintBusinessError(ANNULLED_REPRINT_MESSAGE);
  }

  const printedAt = deps.now();
  const data = encodeEscPos(
    composeReceipt(sale, {
      columns: RECEIPT_COLUMNS[deps.printer.paperWidth],
      copia,
      printedAt,
    }),
  );
  try {
    await deps.transport.send(deps.printer, data);
  } catch (error) {
    deps.logFailure(`Falla de impresión: venta ${sale.ventaId}`, error);
    throw new ReceiptPrintFailedError(
      `${PRINT_FAILED_MESSAGE} Destino: ${describePrinterTarget(deps.printer)}.`,
    );
  }

  // Solo la reimpresión se audita; la impresión automática acompaña a la venta.
  if (copia) {
    try {
      await deps.audit({
        descripcion: `Reimpresión de boleta de la venta ${sale.ventaId}.`,
        modulo: "ventas",
        tipoAccion: "reimpresion_boleta",
        usuarioId,
      });
    } catch (error) {
      deps.logFailure(`Auditoría de reimpresión: venta ${sale.ventaId}`, error);
      throw new ReceiptAuditError(
        "La copia fue impresa, pero no fue posible registrar su auditoría.",
      );
    }
  }

  return { ventaId: sale.ventaId, copia, impresaEn: printedAt.toISOString() };
}
