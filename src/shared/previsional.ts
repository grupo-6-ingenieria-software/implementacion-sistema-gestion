export type TasaLegalTipo = "afp" | "salud" | "cesantia";

export const PREVISIONAL_TIPOS: readonly TasaLegalTipo[] = [
  "afp",
  "salud",
  "cesantia",
];

export const PREVISIONAL_TIPO_LABELS: Record<TasaLegalTipo, string> = {
  afp: "AFP",
  salud: "Salud",
  cesantia: "Seguro de cesantia",
};

export type PrevisionalRates = Record<TasaLegalTipo, number>;

export const DEFAULT_PREVISIONAL_RATES: PrevisionalRates = {
  afp: 11.5,
  salud: 7,
  cesantia: 0.6,
};

export type PrevisionalFieldErrors = Partial<Record<TasaLegalTipo, string>>;

export type PrevisionalUpdatePayload = {
  usuarioId?: string;
} & PrevisionalRates;

export function normalizePrevisionalUpdatePayload(
  payload: unknown,
): { usuarioId?: string } & PrevisionalRates {
  const record = isRecord(payload) ? payload : {};

  return {
    usuarioId: getOptionalString(record, "usuarioId"),
    afp: normalizeRate(record.afp),
    salud: normalizeRate(record.salud),
    cesantia: normalizeRate(record.cesantia),
  };
}

export function validatePrevisionalRates(
  values: PrevisionalRates,
): PrevisionalFieldErrors {
  const errors: PrevisionalFieldErrors = {};

  for (const tipo of PREVISIONAL_TIPOS) {
    const value = values[tipo];

    if (!Number.isFinite(value)) {
      errors[tipo] = "Ingrese un porcentaje numerico.";
    } else if (value < 0 || value > 100) {
      errors[tipo] = "El porcentaje debe estar entre 0 y 100.";
    }
  }

  return errors;
}

export function hasPrevisionalFieldErrors(
  errors: PrevisionalFieldErrors,
): boolean {
  return Object.values(errors).some(Boolean);
}

function normalizeRate(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return Number(value.trim().replace(",", "."));
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
