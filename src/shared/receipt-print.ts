// RF63: impresión de boletas en la impresora térmica del equipo.

export type PrinterTransport = "usb" | "tcp";
export type PaperWidth = 80 | 58;

export type PrinterConfig = {
  transport: PrinterTransport;
  // USB: nombre de la impresora instalada; sin nombre se usa la predeterminada.
  printerName?: string;
  // TCP: solo desarrollo con el emulador escpresso.
  host?: string;
  port?: number;
  paperWidth: PaperWidth;
};

export type ReceiptPrintRequest = {
  ventaId: string;
  copia?: boolean;
};

export type ReceiptPrintResult = {
  ventaId: string;
  copia: boolean;
  impresaEn: string;
};

export const RECEIPT_COLUMNS: Record<PaperWidth, number> = { 80: 48, 58: 32 };

// Datos del negocio impresos en la boleta, tomados de la boleta real del local.
export const NEGOCIO = {
  rut: "76731539-2",
  nombre: "LA PANADERIA",
  lineas: [
    "SOC. COMERCIAL CRISTIAN CARRENO LTDA.",
    "MINIMARKET Y PANADERIA",
    "HUASCAR 200",
    "RENGO",
  ],
  telefono: "+56941802148",
  correo: "jmacristian@gmail.com",
} as const;

export const RECEIPT_LEGEND = "DOCUMENTO NO VALIDO COMO BOLETA ELECTRONICA SII";

export const PRINT_FAILED_MESSAGE =
  "No fue posible imprimir la boleta. Revise que la impresora esté encendida, con papel y conectada.";
export const ANNULLED_REPRINT_MESSAGE =
  "No se reimprimen boletas de ventas anuladas.";

export function describePrinterTarget(config: PrinterConfig): string {
  if (config.transport === "tcp") return `${config.host}:${config.port}`;
  return config.printerName
    ? `la impresora ${config.printerName}`
    : "la impresora predeterminada del equipo";
}
