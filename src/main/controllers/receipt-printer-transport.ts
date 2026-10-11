import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrinterConfig } from "../../shared/receipt-print";

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
