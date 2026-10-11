import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main", () => ({ default: { error: vi.fn() } }));
vi.mock("../../../src/db/client", () => ({ db: {}, schema: {} }));

import { CHANNEL_ROLES } from "../../../src/main/controllers/auth-guard";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import { createReceiptPrintController } from "../../../src/main/controllers/receipt-print";
import type { ReceiptPrintDependencies } from "../../../src/main/controllers/receipt-print-service";
import {
  DEV_PRINTER_ENV,
  RECEIPT_PRINTER,
  resolveReceiptPrinter,
} from "../../../src/main/controllers/receipt-printer-settings";
import { PrinterUnavailableError } from "../../../src/main/controllers/receipt-printer-transport";
import { SaleLookupNotFoundError } from "../../../src/main/controllers/sales-history";
import { ANNULLED_REPRINT_MESSAGE, type PrinterConfig } from "../../../src/shared/receipt-print";
import type { SaleDetail } from "../../../src/shared/sales";

const ventaId = "00000000-0000-4000-8000-000000000901";
const worker: SessionTokenClaims = { usuarioId: "22222222-2", rol: "trabajador", usuarioRol: "trabajador", passwordTemporal: false, sesionId: "00000000-0000-4000-8000-000000000701" };
const usb: PrinterConfig = { transport: "usb", paperWidth: 80 };
const now = new Date("2026-10-11T21:00:00.000Z");

const sale: SaleDetail = {
  ventaId,
  fechaHora: "2026-10-11T20:00:00.000Z",
  estado: "confirmada",
  responsable: { usuarioId: "11111111-1", nombre: "Ana Soto", rol: "trabajador" },
  productos: [{ productoId: 1, ean13: "7802920000015", nombre: "Pan", cantidad: 1, precioUnitario: 1000, subtotal: 1000 }],
  descuento: { tipo: "ninguno", valor: 0 },
  pago: { metodo: "debito" },
  subtotal: 1000,
  total: 1000,
  caja: { cierreCajaId: "c1", estado: "abierta", fechaApertura: "2026-10-11T12:00:00.000Z" },
};

function deps(overrides: Partial<ReceiptPrintDependencies> = {}) {
  const base = {
    loadSale: vi.fn(async () => sale),
    printer: usb,
    transport: { send: vi.fn(async () => undefined) },
    audit: vi.fn(async () => undefined),
    logFailure: vi.fn(),
    now: () => now,
  };
  return { ...base, ...overrides } as typeof base;
}

const sent = (d: ReturnType<typeof deps>) =>
  d.transport.send.mock.calls[0] as unknown as [PrinterConfig, Uint8Array];

afterEach(() => vi.restoreAllMocks());

describe("RF63 C62 ImpresionBoletaHandler", () => {
  it("imprime la boleta de la venta registrada sin auditar la impresión automática", async () => {
    const d = deps();
    const response = await createReceiptPrintController(d).handle(
      { ventaId, copia: false },
      { channel: "boleta:imprimir", claims: worker },
    );

    expect(response).toEqual({ ok: true, data: { ventaId, copia: false, impresaEn: now.toISOString() } });
    expect(d.loadSale).toHaveBeenCalledWith(ventaId);
    expect(sent(d)[0]).toEqual(usb);
    expect(Buffer.from(sent(d)[1]).toString("latin1")).toContain("BOLETA DE VENTA");
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("reimprime como copia y registra la reimpresión en el log de auditoría", async () => {
    const d = deps();
    const response = await createReceiptPrintController(d).handle(
      { ventaId, copia: true },
      { channel: "boleta:imprimir", claims: worker },
    );

    expect(response).toMatchObject({ ok: true, data: { copia: true } });
    expect(Buffer.from(sent(d)[1]).toString("latin1")).toContain("*** COPIA ***");
    expect(d.audit).toHaveBeenCalledWith({
      descripcion: `Reimpresión de boleta de la venta ${ventaId}.`,
      modulo: "ventas",
      tipoAccion: "reimpresion_boleta",
      usuarioId: worker.usuarioId,
    });
  });

  it("rechaza reimprimir una venta anulada sin enviar nada a la impresora (CU63b-E1)", async () => {
    const d = deps({ loadSale: vi.fn(async () => ({ ...sale, estado: "anulada" as const })) });
    const response = await createReceiptPrintController(d).handle(
      { ventaId, copia: true },
      { channel: "boleta:imprimir", claims: worker },
    );

    expect(response).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE", message: ANNULLED_REPRINT_MESSAGE } });
    expect(d.transport.send).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("registra la falla técnica y no audita cuando la impresora no responde (CU63-E1, CU63b-E2)", async () => {
    const d = deps();
    d.transport.send.mockRejectedValueOnce(new PrinterUnavailableError("sin respuesta"));
    const response = await createReceiptPrintController(d).handle(
      { ventaId, copia: true },
      { channel: "boleta:imprimir", claims: worker },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "TECHNICAL_ERROR", message: expect.stringContaining("la impresora predeterminada del equipo") },
    });
    expect(d.logFailure).toHaveBeenCalledWith(`Falla de impresión: venta ${ventaId}`, expect.any(PrinterUnavailableError));
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("informa cuando la copia se imprimió pero la auditoría falló", async () => {
    const d = deps({ audit: vi.fn(async () => { throw new Error("db"); }) });
    const response = await createReceiptPrintController(d).handle(
      { ventaId, copia: true },
      { channel: "boleta:imprimir", claims: worker },
    );

    expect(d.transport.send).toHaveBeenCalledOnce();
    expect(response).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });

  it.each([
    [{ ventaId: "no-es-uuid" }, "VALIDATION_ERROR"],
    [{ ventaId }, "NOT_FOUND"],
  ])("valida el número de venta %#", async (payload, code) => {
    const d = deps({ loadSale: vi.fn(async () => { throw new SaleLookupNotFoundError("La venta indicada no fue encontrada."); }) });
    const response = await createReceiptPrintController(d).handle(payload, { channel: "boleta:imprimir", claims: worker });
    expect(response).toMatchObject({ ok: false, error: { code } });
  });

  it("rechaza llamadas directas sin sesión y canales desconocidos", async () => {
    const d = deps();
    const controller = createReceiptPrintController(d);
    expect(await controller.handle({ ventaId }, { channel: "boleta:imprimir" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await controller.handle({}, { channel: "boleta:config-guardar", claims: worker })).toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
    expect(d.transport.send).not.toHaveBeenCalled();
    expect(controller.metadata).toMatchObject({ id: "receipt-print", name: "ImpresionBoletaHandler", channels: ["boleta:imprimir"] });
  });

  it("permite imprimir y reimprimir a ambos roles", () => {
    expect([...CHANNEL_ROLES.get("boleta:imprimir")!].sort()).toEqual(["dueno", "trabajador"]);
  });

  it("por defecto usa la térmica USB de Windows y solo usa escpresso si se pide por variable de entorno", () => {
    expect(resolveReceiptPrinter({})).toBe(RECEIPT_PRINTER);
    expect(RECEIPT_PRINTER).toEqual({ transport: "usb", paperWidth: 80 });
    expect(resolveReceiptPrinter({ [DEV_PRINTER_ENV]: "  " })).toBe(RECEIPT_PRINTER);
    expect(resolveReceiptPrinter({ [DEV_PRINTER_ENV]: "127.0.0.1:9100" })).toEqual({
      transport: "tcp", host: "127.0.0.1", port: 9100, paperWidth: 80,
    });
  });
});
