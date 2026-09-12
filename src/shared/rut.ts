/**
 * Normalizacion historica usada por usuarios. Conserva el guion tal como fue
 * ingresado para no cambiar el contrato de ese modulo.
 */
export function normalizeRut(value: string): string {
  return value.replace(/\./g, "").replace(/\s/g, "").toUpperCase();
}

export function formatRutInput(value: string): string {
  const clean = rutToBackend(value);

  if (clean.length <= 1) {
    return clean;
  }

  return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

/** Solo cuerpo y digito verificador, sin separadores. */
export function rutToBackend(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^0-9K]/g, "")
    .slice(0, 9);
}

export function calculateRutVerifier(body: string): string | null {
  if (!/^\d{7,8}$/.test(body)) {
    return null;
  }

  let multiplier = 2;
  let sum = 0;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  return remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
}

/** Validacion usada por usuarios; acepta exactamente el formato historico. */
export function isValidRut(value: string): boolean {
  const normalized = normalizeRut(value);
  const match = /^(\d{7,8})-([\dK])$/.exec(normalized);

  if (!match) {
    return false;
  }

  return calculateRutVerifier(match[1]) === match[2];
}

/**
 * Convierte las representaciones usuales de un RUT chileno a cuerpo-DV.
 * Retorna una cadena vacia si el cuerpo, el DV o su calculo no son validos.
 */
export function canonicalizeRut(value: string): string {
  const normalized = normalizeRut(value);
  const match = /^([1-9]\d{6,7})-?([0-9K])$/.exec(normalized);

  if (!match) {
    return "";
  }

  const [, body, verifier] = match;

  if (calculateRutVerifier(body) !== verifier) {
    return "";
  }

  return `${body}-${verifier}`;
}

export function isValidChileanRut(value: string): boolean {
  return canonicalizeRut(value) !== "";
}

/** Clave tolerante para comparar datos legados con separadores distintos. */
export function rutComparisonKey(value: string): string {
  return value.replace(/[.\s-]/g, "").toUpperCase();
}
