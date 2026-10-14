/** CLP y unidades viajan como number; nunca aceptar un entero impreciso. */
export class NumericRangeError extends RangeError {
  constructor(message = "El valor o resultado supera el rango permitido.") {
    super(message);
    this.name = "NumericRangeError";
  }
}

export function parseClpAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) return null;
  const amount = Number(text.replaceAll(".", ""));
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

/** Unidades sin agrupación CLP: comprueba el texto antes del redondeo de Number. */
export function parseIntegerInput(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  const text = value.trim();
  const number = Number(text);
  // Las fracciones visibles llegan al validador existente sin truncarse.
  if (Number.isFinite(number) && !Number.isInteger(number)) return number;
  if (!Number.isSafeInteger(number)) return Number.NaN;

  const decimal = text.match(/^[+-]?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
  if (decimal) {
    const fraction = decimal[1].split(".")[1] ?? "";
    const scale = fraction.length - Number(decimal[2] ?? 0);
    const digits = decimal[1].replace(".", "");
    // Una fracción distinta de cero puede haberse redondeado a un entero seguro.
    if (scale > 0 && /[1-9]/.test(digits.slice(-scale))) return Number.NaN;
  }
  return number;
}

/** TEXT evita que libSQL falle antes de que podamos validar datos antiguos. */
export function safeInteger(value: unknown): number {
  const number = typeof value === "string" && /^-?\d+$/.test(value)
    ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new NumericRangeError();
  }
  return number;
}

export function checkedAdd(...values: number[]): number {
  return values.reduce((sum, value) => safeInteger(sum + safeInteger(value)), 0);
}

export function checkedMultiply(left: number, right: number): number {
  return safeInteger(safeInteger(left) * safeInteger(right));
}

/** RF34: porcentaje decimal exacto y redondeo al peso, desde medio hacia arriba. */
export function roundClpPercentage(amount: number, percentage: number): number {
  if (safeInteger(amount) < 0 || !Number.isFinite(percentage) ||
    percentage < 0 || percentage > 100) {
    throw new NumericRangeError("El cálculo previsional contiene valores inválidos.");
  }
  const [mantissa, exponent = "0"] = String(percentage).split("e");
  const [integer, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(amount) * BigInt(integer + fraction) *
    10n ** BigInt(Math.max(0, -scale));
  const denominator = 100n * 10n ** BigInt(Math.max(0, scale));
  const rounded = numerator / denominator +
    (numerator % denominator * 2n >= denominator ? 1n : 0n);
  return safeInteger(Number(rounded));
}
