import type { TasaLegalTipo } from "./previsional";

export type RemuneracionFieldErrors = Partial<
  Record<"trabajadorId" | "mes" | "anio" | "montoBruto", string>
>;

export type RemuneracionCreatePayload = {
  usuarioId?: string;
  trabajadorId: number;
  mes: number;
  anio: number;
  montoBruto: number;
  observacion?: string;
};

export type RemuneracionDescuento = {
  tipo: TasaLegalTipo;
  porcentaje: number;
  monto: number;
};

export type RemuneracionCalculo = {
  descuentos: RemuneracionDescuento[];
  montoLiquido: number;
};

export type RemuneracionMutationResponse = RemuneracionCalculo & {
  remuneracionId: string;
};

export const MESES_LABEL = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export const MIN_REMUNERACION_ANIO = 2020;
export const MAX_REMUNERACION_ANIO = 2100;

export function normalizeRemuneracionCreatePayload(
  payload: unknown,
): RemuneracionCreatePayload {
  const record = isRecord(payload) ? payload : {};

  return {
    usuarioId: getOptionalString(record, "usuarioId"),
    trabajadorId: normalizeInteger(record.trabajadorId),
    mes: normalizeInteger(record.mes),
    anio: normalizeInteger(record.anio),
    montoBruto: normalizeInteger(record.montoBruto),
    observacion: getOptionalString(record, "observacion"),
  };
}

export function validateRemuneracionCreatePayload(
  values: RemuneracionCreatePayload,
): RemuneracionFieldErrors {
  const errors: RemuneracionFieldErrors = {};

  if (!Number.isInteger(values.trabajadorId) || values.trabajadorId <= 0) {
    errors.trabajadorId = "Seleccione un trabajador.";
  }

  if (!Number.isInteger(values.mes) || values.mes < 1 || values.mes > 12) {
    errors.mes = "Seleccione un mes valido.";
  }

  if (
    !Number.isInteger(values.anio) ||
    values.anio < MIN_REMUNERACION_ANIO ||
    values.anio > MAX_REMUNERACION_ANIO
  ) {
    errors.anio = "Ingrese un anio valido.";
  }

  if (!Number.isFinite(values.montoBruto) || values.montoBruto <= 0) {
    errors.montoBruto = "El monto bruto debe ser mayor a 0.";
  }

  return errors;
}

export function hasRemuneracionFieldErrors(
  errors: RemuneracionFieldErrors,
): boolean {
  return Object.values(errors).some(Boolean);
}

/** Redondeo "desde medio peso hacia arriba" (round half up) exigido por RF34. */
export function roundToNearestPeso(value: number): number {
  return Math.floor(value + 0.5);
}

export function calculateRemuneracion(
  montoBruto: number,
  rates: readonly { tipo: TasaLegalTipo; porcentaje: number }[],
): RemuneracionCalculo {
  const descuentos = rates.map((rate) => ({
    tipo: rate.tipo,
    porcentaje: rate.porcentaje,
    monto: roundToNearestPeso((montoBruto * rate.porcentaje) / 100),
  }));

  const montoLiquido =
    montoBruto -
    descuentos.reduce((sum, descuento) => sum + descuento.monto, 0);

  return { descuentos, montoLiquido };
}

function normalizeInteger(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
  }

  return Number.NaN;
}

function getOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
