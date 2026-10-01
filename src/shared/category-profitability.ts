import { isValidSaleHistoryDate } from "./sales";

export const CATEGORY_PROFITABILITY_REPORT_TYPE = "rentabilidad-categoria";
export const PROFITABILITY_RANGE_ERROR = "La fecha de inicio no puede ser posterior a la fecha de término";

export type ProfitabilityPeriod = { fechaInicio: string; fechaTermino: string };
export type CategoryProfitability = {
  categoriaId: number;
  categoriaNombre: string;
  unidadesVendidas: number;
  costoTotal: number;
  ingresoNeto: number;
  gananciaPorcentual: number | null;
};
export type CategoryProfitabilityReport = {
  periodo: ProfitabilityPeriod;
  categorias: CategoryProfitability[];
};

export function parseProfitabilityPeriod(payload: unknown): ProfitabilityPeriod {
  const input = payload as Partial<ProfitabilityPeriod> | null;
  const fechaInicio = typeof input?.fechaInicio === "string" ? input.fechaInicio.trim() : "";
  const fechaTermino = typeof input?.fechaTermino === "string" ? input.fechaTermino.trim() : "";
  if (!isValidSaleHistoryDate(fechaInicio)) throw new RangeError("Ingrese una fecha de inicio válida.");
  if (!isValidSaleHistoryDate(fechaTermino)) throw new RangeError("Ingrese una fecha de término válida.");
  if (fechaInicio > fechaTermino) throw new RangeError(PROFITABILITY_RANGE_ERROR);
  return { fechaInicio, fechaTermino };
}

export function profitabilityPeriodLabel(period: ProfitabilityPeriod): string {
  return `${period.fechaInicio.split("-").reverse().join("/")} al ${period.fechaTermino.split("-").reverse().join("/")}`;
}

export function formatProfitability(value: number | null): string {
  return value === null ? "N/A" : `${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)} %`;
}
