import { NEGOCIO, RECEIPT_LEGEND } from "../../shared/receipt-print";
import type { SaleDetail } from "../../shared/sales";

// UI10 BoletaTermica: composición de la boleta en texto de ancho fijo y su
// codificación ESC/POS. Formato tomado de la boleta real del local, sin los
// elementos tributarios: folio SII, timbre, IVA ni datos del receptor.

export type ReceiptLine = { text: string; bold?: boolean };

export type ComposeReceiptOptions = {
  columns: number;
  copia: boolean;
  printedAt: Date;
};

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
