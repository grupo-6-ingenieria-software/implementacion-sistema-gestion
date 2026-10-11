import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PrinterUnavailableError,
  createPrinterTransport,
  sendTcp,
  type CommandRunner,
} from "../../../src/main/controllers/receipt-printer-transport";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function captureServer(): Promise<{ port: number; received: Promise<Buffer> }> {
  return new Promise((resolve) => {
    let deliver!: (data: Buffer) => void;
    const received = new Promise<Buffer>((done) => (deliver = done));
    server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => {
        deliver(Buffer.concat(chunks));
        socket.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve({ port: typeof address === "object" && address ? address.port : 0, received });
    });
  });
}

describe("transporte de la boleta", () => {
  it("envía los bytes ESC/POS completos por TCP, como recibe escpresso", async () => {
    const { port, received } = await captureServer();
    const data = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x00]);

    await sendTcp("127.0.0.1", port, data);

    expect(Array.from(await received)).toEqual(Array.from(data));
  });

  it("informa impresora no disponible cuando el puerto TCP rechaza la conexión", async () => {
    const { port } = await captureServer();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    await expect(sendTcp("127.0.0.1", port, Uint8Array.from([1]))).rejects.toBeInstanceOf(
      PrinterUnavailableError,
    );
  });

  it("envía por USB en Windows mediante la cola de impresión en modo RAW", async () => {
    let written: number[] = [];
    const run = vi.fn<CommandRunner>(async (_file, _args, env) => {
      written = Array.from(await readFile(env.HUASCAR_RECEIPT_FILE));
      return "";
    });
    const transport = createPrinterTransport({ platform: "win32", run });

    await transport.send({ transport: "usb", printerName: "POS-80C", paperWidth: 80 }, Uint8Array.from([7, 8, 9]));

    const [file, args, env] = run.mock.calls[0];
    expect(file).toBe("powershell.exe");
    expect(args.at(-1)).toContain('pDataType = "RAW"');
    expect(args.at(-1)).toContain("WritePrinter");
    expect(args.at(-1)).not.toContain("POS-80C");
    expect(env.HUASCAR_PRINTER).toBe("POS-80C");
    expect(written).toEqual([7, 8, 9]);
  });

  it("usa la cola CUPS en modo raw fuera de Windows", async () => {
    const run = vi.fn<CommandRunner>(async () => "");
    const transport = createPrinterTransport({ platform: "darwin", run });

    await transport.send({ transport: "usb", printerName: "Termica", paperWidth: 58 }, Uint8Array.from([1]));

    expect(run.mock.calls[0][0]).toBe("lp");
    expect(run.mock.calls[0][1].slice(0, 4)).toEqual(["-d", "Termica", "-o", "raw"]);
  });

  it("convierte una falla de la cola en impresora no disponible", async () => {
    const transport = createPrinterTransport({
      platform: "win32",
      run: async () => {
        throw new Error("Impresora sin conexion: POS-80C");
      },
    });

    await expect(
      transport.send({ transport: "usb", printerName: "POS-80C", paperWidth: 80 }, Uint8Array.from([1])),
    ).rejects.toThrow(/POS-80C/);
  });

  it("delega la conexión TCP según la configuración", async () => {
    const tcp = vi.fn(async () => undefined);
    const transport = createPrinterTransport({ tcp });
    const data = Uint8Array.from([1]);

    await transport.send({ transport: "tcp", host: "127.0.0.1", port: 9100, paperWidth: 80 }, data);

    expect(tcp).toHaveBeenCalledWith("127.0.0.1", 9100, data);
  });

  it("sin nombre de impresora usa la predeterminada del equipo", async () => {
    const run = vi.fn<CommandRunner>(async () => "");
    await createPrinterTransport({ platform: "win32", run }).send({ transport: "usb", paperWidth: 80 }, Uint8Array.from([1]));
    expect(run.mock.calls[0][2].HUASCAR_PRINTER).toBe("");
    expect(run.mock.calls[0][1].at(-1)).toContain("$_.Default");

    const lp = vi.fn<CommandRunner>(async () => "");
    await createPrinterTransport({ platform: "linux", run: lp }).send({ transport: "usb", paperWidth: 80 }, Uint8Array.from([1]));
    expect(lp.mock.calls[0][1].slice(0, 2)).toEqual(["-o", "raw"]);
  });
});
