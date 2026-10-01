export type ExpiringLotsReportRequest = {
  horizonte?: number;
  categoriaId?: number | null;
};

export type ExpiringLotItem = {
  loteId: string;
  productoId: number;
  productoNombre: string;
  productoEan13: string;
  categoriaId: number;
  categoriaNombre: string;
  proveedorId: number | null;
  proveedorNombre: string | null;
  cantidad: number;
  fechaVencimiento: string;
  diasRestantes: number;
  precioCosto: number;
  costoEnRiesgo: number;
};

export type CategoryExpiringSummary = {
  categoriaId: number;
  categoriaNombre: string;
  totalLotes: number;
  totalUnidades: number;
  costoEnRiesgo: number;
};

export type ExpiringLotsReportSummary = {
  totalLotes: number;
  totalUnidades: number;
  costoTotalEnRiesgo: number;
  porCategoria: readonly CategoryExpiringSummary[];
};

export type ExpiringLotsCategoryOption = {
  id: number;
  nombre: string;
};

export type ExpiringLotsReportData = {
  horizonte: number;
  categoriaId?: number | null;
  fechaConsulta: string;
  categorias: readonly ExpiringLotsCategoryOption[];
  items: readonly ExpiringLotItem[];
  resumen: ExpiringLotsReportSummary;
};

export const DEFAULT_EXPIRING_LOTS_HORIZON = 7;
export const MIN_EXPIRING_LOTS_HORIZON = 1;
export const MAX_EXPIRING_LOTS_HORIZON = 31;

export const EXPIRING_LOTS_HORIZON_ERROR =
  "Ingrese un valor entre 1 y 31 días";

export const EXPIRING_LOTS_EMPTY_MESSAGE =
  "No se encontraron lotes próximos a vencer para los filtros seleccionados.";

export function validateHorizon(
  value: unknown,
): { ok: true; horizon: number } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, horizon: DEFAULT_EXPIRING_LOTS_HORIZON };
  }

  const num = typeof value === "number" ? value : Number(value);
  if (
    Number.isNaN(num) ||
    !Number.isInteger(num) ||
    num < MIN_EXPIRING_LOTS_HORIZON ||
    num > MAX_EXPIRING_LOTS_HORIZON
  ) {
    return { ok: false, error: EXPIRING_LOTS_HORIZON_ERROR };
  }

  return { ok: true, horizon: num };
}

export function normalizeExpiringLotsRequest(
  payload: unknown,
): ExpiringLotsReportRequest {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  let horizonte: number | undefined;
  if (record.horizonte === undefined || record.horizonte === null || record.horizonte === "") {
    horizonte = DEFAULT_EXPIRING_LOTS_HORIZON;
  } else {
    horizonte = typeof record.horizonte === "number" ? record.horizonte : Number(record.horizonte);
  }

  let categoriaId: number | null | undefined;
  if (record.categoriaId !== undefined && record.categoriaId !== null && record.categoriaId !== "") {
    const parsedCat = Number(record.categoriaId);
    if (!Number.isNaN(parsedCat)) {
      categoriaId = parsedCat;
    }
  }

  return {
    horizonte,
    categoriaId: categoriaId ?? undefined,
  };
}

export function validateExpiringLotsRequest(
  request: ExpiringLotsReportRequest,
): { ok: true; horizon: number } | { ok: false; error: string } {
  return validateHorizon(request.horizonte);
}

export function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}
