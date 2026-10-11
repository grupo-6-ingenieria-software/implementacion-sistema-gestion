import type { PrinterConfig } from "../../shared/receipt-print";

// Impresora de boletas (RF63), configurada en el código: impresora térmica USB
// por la cola de Windows en modo RAW. Sin printerName se usa la impresora
// predeterminada del equipo; si el terminal de caja tiene otra predeterminada,
// fijar aquí el nombre exacto de la térmica.
export const RECEIPT_PRINTER: PrinterConfig = {
  transport: "usb",
  paperWidth: 80,
};

// Solo desarrollo, sin documentar: HUASCAR_IMPRESORA_TCP=127.0.0.1:9100 envía la
// boleta al emulador escpresso. Puede eliminarse antes del despliegue.
export const DEV_PRINTER_ENV = "HUASCAR_IMPRESORA_TCP";

export function resolveReceiptPrinter(
  env: Record<string, string | undefined> = process.env,
): PrinterConfig {
  const target = env[DEV_PRINTER_ENV]?.trim();
  if (!target) return RECEIPT_PRINTER;
  const [host, port] = target.split(":");
  return {
    transport: "tcp",
    host: host || "127.0.0.1",
    port: Number(port) || 9100,
    paperWidth: RECEIPT_PRINTER.paperWidth,
  };
}
