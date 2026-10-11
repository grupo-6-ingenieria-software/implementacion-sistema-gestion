import { describe, expect, it } from "vitest";
import {
  composeReceipt,
  encodeEscPos,
  toReceiptText,
} from "../../../src/main/controllers/receipt-escpos";
import { NEGOCIO, RECEIPT_LEGEND } from "../../../src/shared/receipt-print";
import type { SaleDetail } from "../../../src/shared/sales";

const ventaId = "3f2a9c1e-7b4d-4e8a-9c51-0d2b6e7f8a90";
const printedAt = new Date("2026-10-11T21:05:12.000Z");

function sale(overrides: Partial<SaleDetail> = {}): SaleDetail {
  return {
    ventaId,
    fechaHora: "2026-10-11T20:42:08.000Z",
    estado: "confirmada",
    responsable: { usuarioId: "11111111-1", nombre: "María Huáscar", rol: "dueno" },
    productos: [
      { productoId: 1, ean13: "7801234567893", nombre: "Pan amasado 1 kg", cantidad: 2, precioUnitario: 1990, subtotal: 3980 },
      { productoId: 2, ean13: "7802920000213", nombre: "Leche entera 1 L Colún", cantidad: 3, precioUnitario: 1150, subtotal: 3450 },
    ],
    descuento: { tipo: "monto", valor: 1000, razon: "Cliente frecuente" },
    pago: { metodo: "efectivo", montoRecibido: 10000, vuelto: 3570 },
    subtotal: 7430,
    total: 6430,
    caja: { cierreCajaId: "c1", estado: "abierta", fechaApertura: "2026-10-11T12:00:00.000Z" },
    ...overrides,
  };
}

const texts = (lines: { text: string }[]) => lines.map((line) => line.text);

describe("RF63 composición de la boleta térmica UI10", () => {
  it.each([
    [48, "80 mm"],
    [32, "58 mm"],
  ])("ninguna línea supera las %i columnas del papel de %s", (columns) => {
    for (const copia of [false, true]) {
      const lines = composeReceipt(sale(), { columns, copia, printedAt });
      for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(columns);
    }
  });

  it("replica el formato de la boleta del local sin elementos tributarios ni rol", () => {
    const body = texts(composeReceipt(sale(), { columns: 48, copia: false, printedAt })).join("\n");

    expect(body).toContain(`RUT : ${NEGOCIO.rut}`);
    expect(body).toContain("BOLETA DE VENTA");
    expect(body).toContain(ventaId.toUpperCase());
    expect(body).toContain(NEGOCIO.nombre);
    expect(body).toContain("HUASCAR 200");
    expect(body).toContain(`${NEGOCIO.telefono} ${NEGOCIO.correo}`);
    expect(body).toContain("EMISION: 11-10-2026");
    expect(body).toContain("PAGO: EFECTIVO");
    expect(body).toMatch(/CAJERO: MARIA HUASCAR\s+17:42:08/);
    expect(body).toContain("DETALLE");
    expect(body).toMatch(/7801234567893 {2}1\.990 X 2 UN = \$\s+3\.980/);
    expect(body).toContain("LECHE ENTERA 1 L COLUN");
    expect(body).toContain("SUBTOTAL: $ 7.430");
    expect(body).toContain("DESCUENTO: -$ 1.000");
    expect(body).toContain("RAZON DESCUENTO: CLIENTE FRECUENTE");
    expect(body).toContain("TOTAL: $ 6.430");
    expect(body).toContain("PAGOS: $ 10.000");
    expect(body).toContain("VUELTO: $ 3.570");
    expect(body).toContain(RECEIPT_LEGEND);
    for (const forbidden of ["DUENO", "DUEÑO", "TRABAJADOR", "IVA", "TIMBRE", "S.I.I.", "VENCE", "COPIA"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("marca la reimpresión como copia con su fecha y hora", () => {
    const body = texts(composeReceipt(sale(), { columns: 48, copia: true, printedAt })).join("\n");
    expect(body).toContain("*** COPIA ***");
    expect(body).toContain("COPIA REIMPRESA 11-10-2026 18:05:12");
  });

  it("en pago electrónico informa el total pagado y omite el vuelto", () => {
    const body = texts(
      composeReceipt(
        sale({ pago: { metodo: "debito" }, descuento: { tipo: "ninguno", valor: 0 }, total: 7430 }),
        { columns: 48, copia: false, printedAt },
      ),
    ).join("\n");
    expect(body).toContain("PAGO: DEBITO");
    expect(body).toContain("PAGOS: $ 7.430");
    expect(body).not.toContain("VUELTO");
    expect(body).not.toContain("DESCUENTO");
  });

  it("en 58 mm corta el número de venta solo en guiones y separa EAN y cálculo", () => {
    const lines = texts(composeReceipt(sale(), { columns: 32, copia: false, printedAt }));
    const boxed = lines.filter((line) => line.startsWith("| ")).map((line) => line.slice(2, -2).trim());
    expect(boxed).toContain("3F2A9C1E-7B4D-4E8A-9C51-");
    expect(boxed).toContain("0D2B6E7F8A90");
    expect(lines).toContain("7801234567893");
    expect(lines).toContain(NEGOCIO.correo.padStart(Math.floor((32 - NEGOCIO.correo.length) / 2) + NEGOCIO.correo.length));
  });

  it("normaliza a mayúsculas sin tildes", () => {
    expect(toReceiptText("Ñandú café")).toBe("NANDU CAFE");
  });
});

describe("RF63 codificación ESC/POS", () => {
  it("inicializa, alterna negrita, mapea el símbolo de grado y termina con corte", () => {
    const bytes = Array.from(
      encodeEscPos([{ text: "N° VENTA", bold: true }, { text: "ok" }]),
    );
    expect(bytes.slice(0, 8)).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x00, 0x1b, 0x61, 0x00]);
    const text = (value: string) => Array.from(value, (char) => char.charCodeAt(0));
    expect(bytes.slice(8, -6)).toEqual([
      0x1b, 0x45, 0x01, 0x4e, 0xf8, ...text(" VENTA"), 0x0a, 0x1b, 0x45, 0x00,
      ...text("ok"), 0x0a,
    ]);
    expect(bytes.slice(-6)).toEqual([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x00]);
  });

  it("reemplaza caracteres no imprimibles por signo de interrogación", () => {
    const bytes = Array.from(encodeEscPos([{ text: "€" }]));
    expect(bytes.slice(8, 10)).toEqual([0x3f, 0x0a]);
  });
});
