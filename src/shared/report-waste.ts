import type { WasteReason } from "./waste";

export type WasteReportRequest = {
  fechaInicio: string;
  fechaTermino: string;
  usuarioId?: string;
};

export type WasteReportItem = {
  id: string;
  fechaHora: string;
  productoNombre: string;
  productoEan13: string;
  categoriaNombre: string;
  cantidad: number;
  motivo: WasteReason;
  observacion?: string;
  usuarioNombre: string;
  loteId: string;
  costoUnitario: number;
  costoTotal: number;
};

export type WasteReportSummary = {
  unidadesPorMotivo: Record<WasteReason, number>;
  totalUnidades: number;
  costoTotal: number;
};

export type WasteReportData = {
  fechaInicio: string;
  fechaTermino: string;
  items: readonly WasteReportItem[];
  resumen: WasteReportSummary;
};

export const WASTE_REPORT_EMPTY_MESSAGE =
  "No se encontraron mermas para el período indicado.";

export const WASTE_REPORT_DATE_RANGE_ERROR =
  "La fecha de inicio no puede ser posterior a la de término.";

export const WASTE_REPORT_INVALID_DATE_ERROR =
  "Las fechas ingresadas no son válidas.";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeWasteReportRequest(payload: unknown): WasteReportRequest {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  return {
    fechaInicio: typeof record.fechaInicio === "string" ? record.fechaInicio.trim() : "",
    fechaTermino: typeof record.fechaTermino === "string" ? record.fechaTermino.trim() : "",
    usuarioId: typeof record.usuarioId === "string" ? record.usuarioId.trim() : undefined,
  };
}

export function validateWasteReportRequest(
  request: WasteReportRequest,
): { ok: true } | { ok: false; error: string } {
  if (!isValidDateString(request.fechaInicio) || !isValidDateString(request.fechaTermino)) {
    return { ok: false, error: WASTE_REPORT_INVALID_DATE_ERROR };
  }

  if (request.fechaInicio > request.fechaTermino) {
    return { ok: false, error: WASTE_REPORT_DATE_RANGE_ERROR };
  }

  return { ok: true };
}
