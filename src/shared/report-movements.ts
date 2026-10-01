export type MovementReportType =
  | "ingreso_lote"
  | "venta"
  | "restitucion"
  | "merma"
  | "ajuste_manual";

export const MOVEMENT_TYPE_LABELS: Record<MovementReportType, string> = {
  ingreso_lote: "Ingreso de lote",
  venta: "Venta",
  restitucion: "Restitución",
  merma: "Merma",
  ajuste_manual: "Ajuste manual",
};

export type MovementReportRequest = {
  fechaInicio: string;
  fechaTermino: string;
  tipo?: MovementReportType;
  categoriaId?: number;
  usuarioId?: string;
};

export type MovementReportItem = {
  id: string;
  fechaHora: string;
  tipo: MovementReportType;
  tipoLabel: string;
  productoId: number;
  productoNombre: string;
  productoEan13: string;
  categoriaId: number;
  categoriaNombre: string;
  cantidad: number;
  saldo: number;
  loteId?: string;
  descripcion: string;
  usuarioId: string;
  usuarioNombre: string;
};

export type MovementTypeSummary = {
  tipo: MovementReportType;
  tipoLabel: string;
  totalMovimientos: number;
  totalUnidades: number;
};

export type MovementReportSummary = {
  totalMovimientos: number;
  totalEntradas: number;
  totalSalidas: number;
  resumenPorTipo: readonly MovementTypeSummary[];
};

export type MovementReportCategoryOption = {
  id: number;
  nombre: string;
};

export type MovementReportUserOption = {
  id: string;
  nombre: string;
};

export type MovementReportTypeOption = {
  id: MovementReportType;
  label: string;
};

export type MovementReportData = {
  fechaInicio: string;
  fechaTermino: string;
  tipo?: MovementReportType | null;
  categoriaId?: number | null;
  usuarioId?: string | null;
  categorias: readonly MovementReportCategoryOption[];
  usuarios: readonly MovementReportUserOption[];
  tipos: readonly MovementReportTypeOption[];
  items: readonly MovementReportItem[];
  resumen: MovementReportSummary;
};

export const MOVEMENT_REPORT_DATE_RANGE_ERROR =
  "La fecha de inicio no puede ser posterior a la de término.";

export const MOVEMENT_REPORT_EMPTY_MESSAGE =
  "No se encontraron movimientos para el período indicado.";

export const MOVEMENT_REPORT_INVALID_DATE_ERROR =
  "Las fechas ingresadas no son válidas.";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function normalizeMovementReportRequest(
  payload: unknown,
): MovementReportRequest {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  let categoriaId: number | undefined;
  if (
    record.categoriaId !== undefined &&
    record.categoriaId !== null &&
    record.categoriaId !== ""
  ) {
    const parsed = Number(record.categoriaId);
    if (!Number.isNaN(parsed)) {
      categoriaId = parsed;
    }
  }

  const tipoRaw = typeof record.tipo === "string" ? record.tipo.trim() : "";
  const tipo =
    tipoRaw === "ingreso_lote" ||
    tipoRaw === "venta" ||
    tipoRaw === "restitucion" ||
    tipoRaw === "merma" ||
    tipoRaw === "ajuste_manual"
      ? (tipoRaw as MovementReportType)
      : undefined;

  return {
    fechaInicio:
      typeof record.fechaInicio === "string" ? record.fechaInicio.trim() : "",
    fechaTermino:
      typeof record.fechaTermino === "string" ? record.fechaTermino.trim() : "",
    tipo,
    categoriaId,
    usuarioId:
      typeof record.usuarioId === "string" && record.usuarioId.trim()
        ? record.usuarioId.trim()
        : undefined,
  };
}

export function validateMovementReportRequest(
  request: MovementReportRequest,
): { ok: true } | { ok: false; error: string } {
  if (
    !isValidDateString(request.fechaInicio) ||
    !isValidDateString(request.fechaTermino)
  ) {
    return { ok: false, error: MOVEMENT_REPORT_INVALID_DATE_ERROR };
  }

  if (request.fechaInicio > request.fechaTermino) {
    return { ok: false, error: MOVEMENT_REPORT_DATE_RANGE_ERROR };
  }

  return { ok: true };
}

export function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}
