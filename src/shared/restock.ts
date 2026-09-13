export type RestockListRequest = {
  usuarioId?: string;
};

export type RestockItem = {
  nombre: string;
  ean13: string;
  categoria: string;
  stockActual: number;
  stockMinimo: number;
  cantidadSugerida: number;
};

export type RestockExportFormat = "pdf" | "xlsx";

export type RestockExportResult = {
  formato: RestockExportFormat;
  estado: "saved" | "cancelled";
  ruta?: string;
  cantidadFilas: number;
  fechaGeneracion: string;
};

export const RESTOCK_EMPTY_MESSAGE =
  "No hay productos que requieran reabastecimiento";
export const RESTOCK_EXPORT_ERROR_MESSAGE =
  "No fue posible generar el archivo. Intente nuevamente";

export function normalizeRestockListRequest(
  payload: unknown,
): RestockListRequest {
  if (!isRecord(payload) || typeof payload.usuarioId !== "string") {
    return {};
  }

  const usuarioId = payload.usuarioId.trim();
  return usuarioId ? { usuarioId } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
