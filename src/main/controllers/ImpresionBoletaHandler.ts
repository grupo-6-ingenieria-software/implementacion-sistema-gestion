import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import log from "electron-log/main";
import { controllers } from "../../shared/controllers";
import { db, schema as appSchema } from "../../db/client";
import {
  ANNULLED_REPRINT_MESSAGE,
  NEGOCIO,
  PRINT_FAILED_MESSAGE,
  RECEIPT_COLUMNS,
  RECEIPT_LEGEND,
  describePrinterTarget,
  type PrinterConfig,
  type ReceiptPrintRequest,
  type ReceiptPrintResult,
} from "../../shared/receipt-print";
import { isValidSaleId, type SaleDetail, type SaleSearchRequest } from "../../shared/sales";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import { demoTraceStep, traceDemoCall } from "../demo-trace";
import { registerAuditLog } from "./ContextoAutenticacionAuxiliar";
import {
  SaleLookupNotFoundError,
  SaleLookupValidationError,
  loadSaleDetail,
  type SalesHistoryDb,
} from "./HistorialVentasHandler";

export type ReceiptLine = { text: string; bold?: boolean };

export type ComposeReceiptOptions = {
  columns: number;
  copia: boolean;
  printedAt: Date;
};

// Transporte de la boleta hacia la impresora térmica.
// USB: modo RAW en la cola de impresión del sistema operativo (C_spoolerWindows).
// TCP: socket al puerto 9100; solo para desarrollo con escpresso e impresoras de red.

export class PrinterUnavailableError extends Error {}

export type CommandRunner = (
  file: string,
  args: string[],
  env: Record<string, string>,
) => Promise<string>;

export type PrinterTransport = {
  send: (config: PrinterConfig, data: Uint8Array) => Promise<void>;
};

const COMMAND_TIMEOUT_MS = 20_000;
const TCP_TIMEOUT_MS = 5_000;

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

// UI10 BoletaTermica: composición de la boleta en texto de ancho fijo y su
// codificación ESC/POS. Formato tomado de la boleta real del local, sin los
// elementos tributarios: folio SII, timbre, IVA ni datos del receptor.

const PAYMENT_LABELS: Record<SaleDetail["pago"]["metodo"], string> = {
  efectivo: "EFECTIVO",
  debito: "DEBITO",
  credito: "CREDITO",
  transferencia: "TRANSFERENCIA",
};

// Mayúsculas sin tildes, igual que la boleta original; además evita depender de
// la página de códigos de cada impresora.
export function toReceiptText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

function money(value: number): string {
  return `$ ${Math.round(value).toLocaleString("es-CL")}`;
}

function amount(value: number): string {
  return Math.round(value).toLocaleString("es-CL");
}

function chileParts(date: Date): { fecha: string; hora: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    fecha: `${parts.day}-${parts.month}-${parts.year}`,
    hora: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function wrapWords(text: string, columns: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > columns) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += columns) {
        lines.push(word.slice(i, i + columns));
      }
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > columns) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Corta en guiones para que el número de venta no se parta dentro de un bloque.
function wrapAtHyphens(text: string, columns: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const part of text.split(/(?<=-)/)) {
    if (current && (current + part).length > columns) {
      lines.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => wrapWords(line, columns));
}

function center(text: string, columns: number): string {
  const pad = Math.max(0, Math.floor((columns - text.length) / 2));
  return " ".repeat(pad) + text;
}

function right(text: string, columns: number): string {
  return " ".repeat(Math.max(0, columns - text.length)) + text;
}

function leftRight(left: string, rightText: string, columns: number): string {
  const space = Math.max(1, columns - left.length - rightText.length);
  return left + " ".repeat(space) + rightText;
}

export function composeReceipt(
  sale: SaleDetail,
  options: ComposeReceiptOptions,
): ReceiptLine[] {
  const columns = options.columns;
  const inner = columns - 4;
  const lines: ReceiptLine[] = [];
  const push = (text: string, bold = false) =>
    lines.push(bold ? { text, bold } : { text });
  const centered = (text: string, bold = false) =>
    wrapWords(text, columns).forEach((line) => push(center(line, columns), bold));
  const boxRow = (text: string, bold: boolean) =>
    push(`| ${center(text, inner).padEnd(inner)} |`, bold);

  push(`+${"-".repeat(columns - 2)}+`);
  boxRow(`RUT : ${NEGOCIO.rut}`, true);
  boxRow("BOLETA DE VENTA", true);
  boxRow("N° VENTA", true);
  for (const part of wrapAtHyphens(sale.ventaId.toUpperCase(), inner)) {
    boxRow(part, false);
  }
  push(`+${"-".repeat(columns - 2)}+`);

  if (options.copia) centered("*** COPIA ***", true);
  centered(NEGOCIO.nombre, true);
  NEGOCIO.lineas.forEach((line) => centered(line));
  const contacto = `${NEGOCIO.telefono} ${NEGOCIO.correo}`;
  if (contacto.length <= columns) {
    push(center(contacto, columns));
  } else {
    push(center(NEGOCIO.telefono, columns));
    push(center(NEGOCIO.correo, columns));
  }
  push("");

  const emision = chileParts(new Date(sale.fechaHora));
  push(right(`EMISION: ${emision.fecha}`, columns), true);
  push(right(`PAGO: ${PAYMENT_LABELS[sale.pago.metodo]}`, columns));
  const cajero = `CAJERO: ${toReceiptText(sale.responsable.nombre)}`;
  if (cajero.length + 1 + emision.hora.length <= columns) {
    push(leftRight(cajero, emision.hora, columns));
  } else {
    wrapWords(cajero, columns).forEach((line) => push(line));
    push(right(emision.hora, columns));
  }

  const rule = "-".repeat(columns);
  push(rule);
  push(leftRight(center("DETALLE", Math.floor(columns / 2)), "VALOR   ", columns));
  push(rule);

  for (const line of sale.productos) {
    wrapWords(toReceiptText(line.nombre), columns).forEach((text) => push(text));
    const calculo = `${amount(line.precioUnitario)} X ${line.cantidad} UN = $`;
    const valor = amount(line.subtotal);
    const completa = `${line.ean13}  ${calculo}`;
    if (completa.length + 1 + valor.length <= columns) {
      push(leftRight(completa, valor, columns));
    } else {
      push(line.ean13);
      push(leftRight(`  ${calculo}`, valor, columns));
    }
  }
  push(rule);

  push(right(`SUBTOTAL: ${money(sale.subtotal)}`, columns));
  if (sale.descuento.valor > 0) {
    push(right(`DESCUENTO: -${money(sale.descuento.valor)}`, columns));
    if (sale.descuento.razon) {
      wrapWords(
        `RAZON DESCUENTO: ${toReceiptText(sale.descuento.razon)}`,
        columns,
      ).forEach((text) => push(text));
    }
  }
  push(right(`TOTAL: ${money(sale.total)}`, columns), true);
  if (sale.pago.metodo === "efectivo" && sale.pago.montoRecibido !== undefined) {
    push(right(`PAGOS: ${money(sale.pago.montoRecibido)}`, columns));
    push(right(`VUELTO: ${money(sale.pago.vuelto ?? 0)}`, columns));
  } else {
    push(right(`PAGOS: ${money(sale.total)}`, columns));
  }
  push("");
  centered(RECEIPT_LEGEND);
  if (options.copia) {
    const reimpresion = chileParts(options.printedAt);
    centered(`COPIA REIMPRESA ${reimpresion.fecha} ${reimpresion.hora}`);
  }

  return lines;
}

// ---------------------------------------------------------------- ESC/POS
const ESC = 0x1b;
const GS = 0x1d;

// Página de códigos PC437: el texto ya va en ASCII salvo el símbolo °.
function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else if (char === "°") bytes.push(0xf8);
    else bytes.push(0x3f);
  }
  return bytes;
}

export function encodeEscPos(lines: ReceiptLine[]): Uint8Array {
  const bytes: number[] = [
    ESC, 0x40, // ESC @: inicializar
    ESC, 0x74, 0x00, // ESC t 0: página de códigos PC437
    ESC, 0x61, 0x00, // ESC a 0: alineación izquierda; el centrado va en el texto
  ];
  for (const line of lines) {
    if (line.bold) bytes.push(ESC, 0x45, 0x01);
    bytes.push(...encodeText(line.text), 0x0a);
    if (line.bold) bytes.push(ESC, 0x45, 0x00);
  }
  bytes.push(
    ESC, 0x64, 0x04, // ESC d 4: avanzar 4 líneas antes del corte
    GS, 0x56, 0x00, // GS V 0: corte completo
  );
  return Uint8Array.from(bytes);
}

export const runCommand: CommandRunner = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        env: { ...process.env, ...env },
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}\n${stderr}`.trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });

// Envía los bytes en una conexión TCP y espera el cierre limpio del socket.
export function sendTcp(
  host: string,
  port: number,
  data: Uint8Array,
  timeoutMs = TCP_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = createConnection({ host, port });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(timeoutMs, () =>
      finish(new PrinterUnavailableError(`La impresora ${host}:${port} no responde.`)),
    );
    socket.once("error", (error) =>
      finish(new PrinterUnavailableError(`No fue posible conectar con ${host}:${port}: ${error.message}`)),
    );
    socket.once("connect", () => {
      socket.end(Buffer.from(data));
    });
    socket.once("close", (hadError) => {
      if (!hadError) finish();
    });
  });
}

// La impresora y el archivo viajan por variables de entorno para no interpolar
// valores en el script. Sin nombre se usa la impresora predeterminada.
const WINDOWS_RAW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$printers = Get-CimInstance -ClassName Win32_Printer
if ($env:HUASCAR_PRINTER) {
  $printer = $printers | Where-Object { $_.Name -eq $env:HUASCAR_PRINTER } | Select-Object -First 1
} else {
  $printer = $printers | Where-Object { $_.Default } | Select-Object -First 1
}
if (-not $printer) { throw "Impresora no instalada: $($env:HUASCAR_PRINTER)" }
if ($printer.WorkOffline) { throw "Impresora sin conexion: $($printer.Name)" }
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HuascarRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      DOCINFO info = new DOCINFO { pDocName = "Boleta Huascar", pDataType = "RAW" };
      if (StartDocPrinter(handle, 1, info) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
        int written;
        bool ok = WritePrinter(handle, data, data.Length, out written);
        EndPagePrinter(handle);
        if (!ok || written != data.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
[HuascarRawPrinter]::Send($printer.Name, [System.IO.File]::ReadAllBytes($env:HUASCAR_RECEIPT_FILE))
`;

const POWERSHELL_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

export function createPrinterTransport(
  deps: {
    platform?: NodeJS.Platform;
    run?: CommandRunner;
    tcp?: typeof sendTcp;
  } = {},
): PrinterTransport {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? runCommand;
  const tcp = deps.tcp ?? sendTcp;

  async function sendUsb(printerName: string, data: Uint8Array): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "huascar-boleta-"));
    const file = join(dir, "boleta.bin");
    try {
      await writeFile(file, data);
      if (platform === "win32") {
        await run("powershell.exe", [...POWERSHELL_ARGS, WINDOWS_RAW_SCRIPT], {
          HUASCAR_PRINTER: printerName,
          HUASCAR_RECEIPT_FILE: file,
        });
      } else {
        // macOS y Linux: cola CUPS en modo raw.
        const destination = printerName ? ["-d", printerName] : [];
        await run("lp", [...destination, "-o", "raw", file], {});
      }
    } catch (error) {
      throw new PrinterUnavailableError(
        `No fue posible enviar la boleta a ${printerName || "la impresora predeterminada"}: ${(error as Error).message}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    send: (config, data) =>
      config.transport === "usb"
        ? sendUsb(config.printerName ?? "", data)
        : tcp(config.host ?? "", config.port ?? 9100, data),
  };
}

// Impresora de boletas, configurada en el código: impresora térmica USB
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
  demoTraceStep("C_ImpresionBoletaHandler", "Cargar detalle persistido de la venta");
  const sale = await deps.loadSale(request.ventaId.trim());
  if (sale.estado === "anulada") {
    throw new ReceiptPrintBusinessError(ANNULLED_REPRINT_MESSAGE);
  }

  demoTraceStep("C_ImpresionBoletaHandler", "Componer boleta y codificar en ESC/POS");
  const printedAt = deps.now();
  const data = encodeEscPos(
    composeReceipt(sale, {
      columns: RECEIPT_COLUMNS[deps.printer.paperWidth],
      copia,
      printedAt,
    }),
  );
  try {
    await traceDemoCall(
      deps.printer.transport === "usb" ? "C_spoolerWindows" : "Impresora TCP",
      "Enviar boleta en formato ESC/POS",
      () => deps.transport.send(deps.printer, data),
    );
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

// ImpresionBoletaHandler.
const metadata = controllers.find((controller) => controller.id === "receipt-print")!;

export function createImpresionBoletaHandler(
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

export const impresionBoletaHandler = createImpresionBoletaHandler({
  loadSale: (ventaId) =>
    loadSaleDetail(db as unknown as SalesHistoryDb, { ventaId } as SaleSearchRequest),
  printer: resolveReceiptPrinter(),
  transport: createPrinterTransport(),
  audit: (event) => registerAuditLog(db, appSchema, event),
  logFailure: (message, error) => log.error(`[boleta] ${message}`, error),
  now: () => new Date(),
});
