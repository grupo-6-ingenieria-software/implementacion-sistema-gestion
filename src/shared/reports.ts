/** CU54: the renderer describes a generated report; Main owns its data and destination. */
export const REPORT_EXPORT_ERROR_MESSAGE = "No fue posible generar el archivo";
export const REPORT_BUSINESS_NAME = "Minimarket y Panadería Huáscar";
export const REPORT_RECONCILE_CHANNEL = "reporte:conciliar-exportacion";

export type ReportExportFormat = "pdf" | "xlsx";
export type ReportExportRequest<TPeriod = unknown, TFilters = unknown> = {
  tipo: string;
  periodo: TPeriod;
  filtros?: TFilters;
};
export type ReportHeader = {
  negocio: string;
  tipo: string;
  periodo: string;
  fecha: string;
  usuario: string;
};
export type ReportExportResult = {
  formato: ReportExportFormat;
  estado: "saved" | "cancelled";
  cantidadFilas: number;
  fechaGeneracion: string;
  ruta?: string;
};
export type ReportReconcileRequest = { operacionId: string };
export type ReportReconcileResult =
  | { operacionId: string; estado: "saved"; exportacion: ReportExportResult }
  | { operacionId: string; estado: "reverted" | "pending" };

export function reportExportFormat(channel: string): ReportExportFormat | null {
  if (channel === "reporte:exportar-pdf") return "pdf";
  if (channel === "reporte:exportar-xlsx") return "xlsx";
  return null;
}

/** Malformed descriptors must never select the legacy reabastecimiento handler. */
export function isReportExportRequest(channel: string, payload: unknown): boolean {
  if (channel === REPORT_RECONCILE_CHANNEL) return true;
  if (!reportExportFormat(channel)) return false;
  if (payload == null) return false;
  if (typeof payload !== "object" || Array.isArray(payload)) return true;
  const legacyKeys = new Set(["usuarioId", "__authToken", "__rolSesion"]);
  return ["tipo", "periodo", "filtros"].some((key) => key in payload) ||
    Object.keys(payload).some((key) => !legacyKeys.has(key));
}

export function parseReportExportRequest(payload: unknown): ReportExportRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new RangeError("Tipo de reporte no válido.");
  const value = payload as Record<string, unknown>;
  if (typeof value.tipo !== "string" || !value.tipo.trim() || !Object.hasOwn(value, "periodo"))
    throw new RangeError("Tipo de reporte no válido.");
  return { tipo: value.tipo, periodo: value.periodo, ...(Object.hasOwn(value, "filtros") ? { filtros: value.filtros } : {}) };
}

export function isReportOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
