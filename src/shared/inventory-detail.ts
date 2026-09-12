export type ActiveLotItem = {
  loteId: string;
  cantidadActual: number;
  precioCosto?: number;
  fechaIngreso: string;
  fechaVencimiento?: string;
  esPerecible: boolean;
};

export type ProductDetailWithLotsResponse = {
  product: {
    ean13: string;
    nombre: string;
    categoria: string;
    categoriaId: number;
    precioVenta: number;
    precioCosto?: number;
    stockMinimo: number;
    estado: string;
  };
  lots: ActiveLotItem[];
  stockTotal: number;
};

export type StockAdjustmentPayload = {
  ean13: string;
  loteId: string;
  cantidad: number;
  justificacion: string;
  usuarioId?: string;
};

export type StockAdjustmentFieldErrors = Partial<
  Record<"ean13" | "loteId" | "cantidad" | "justificacion", string>
>;

export type StockAdjustmentResponse = {
  ajusteInventarioId: string;
  ean13: string;
  loteId: string;
  cantidadAjustada: number;
  nuevaCantidadLote: number;
};

export type StockAdjustmentLotOption = {
  loteId: string;
  cantidadActual: number;
  precioCosto?: number;
  fechaIngreso: string;
  fechaVencimiento?: string;
  esPerecible: boolean;
};

export type StockAdjustmentAvailability = {
  ean13: string;
  productoNombre: string;
  lots: StockAdjustmentLotOption[];
};

export type MovementType =
  | "ingreso_lote"
  | "merma"
  | "venta"
  | "ajuste_manual"
  | "recepcion"
  | "anulacion";

export type MovementHistoryFilters = {
  ean13?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  tipo?: MovementType;
  loteId?: string;
  page: number;
  pageSize: number;
  usuarioId?: string;
};

export type MovementHistoryItem = {
  id: string;
  tipo: MovementType;
  fecha: string;
  cantidad: number;
  productoEan13: string;
  productoNombre: string;
  loteId?: string;
  descripcion: string;
  usuario: string;
};

export type MovementHistoryResponse = {
  movements: MovementHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
};

export const movementTypeLabels: Record<MovementType, string> = {
  ingreso_lote: "Ingreso de lote",
  merma: "Merma",
  venta: "Venta",
  ajuste_manual: "Ajuste manual",
  recepcion: "Recepcion de pedido",
  anulacion: "Anulacion de venta",
};

const validMovementTypes = new Set<MovementType>([
  "ingreso_lote",
  "merma",
  "venta",
  "ajuste_manual",
  "recepcion",
  "anulacion",
]);

export function normalizeStockAdjustmentPayload(
  payload: unknown,
): StockAdjustmentPayload {
  const record = isRecord(payload) ? payload : {};

  return {
    ean13: typeof record.ean13 === "string" ? record.ean13.trim() : "",
    loteId: typeof record.loteId === "string" ? record.loteId.trim() : "",
    cantidad: normalizeInteger(record.cantidad),
    justificacion:
      typeof record.justificacion === "string"
        ? record.justificacion.trim().slice(0, 200)
        : "",
    usuarioId:
      typeof record.usuarioId === "string"
        ? record.usuarioId.trim()
        : undefined,
  };
}

export function validateStockAdjustmentPayload(
  values: StockAdjustmentPayload,
): StockAdjustmentFieldErrors {
  const fieldErrors: StockAdjustmentFieldErrors = {};

  if (!/^\d{13}$/.test(values.ean13)) {
    fieldErrors.ean13 =
      "El codigo EAN-13 debe tener exactamente 13 digitos numericos.";
  }

  if (!values.loteId) {
    fieldErrors.loteId = "Debe seleccionar un lote.";
  }

  if (!Number.isInteger(values.cantidad) || values.cantidad === 0) {
    fieldErrors.cantidad =
      "La cantidad debe ser un entero distinto de cero.";
  }

  if (!values.justificacion) {
    fieldErrors.justificacion =
      "La justificacion del ajuste es obligatoria.";
  }

  return fieldErrors;
}

export function hasStockAdjustmentFieldErrors(
  errors: StockAdjustmentFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

export function normalizeMovementHistoryFilters(
  payload: unknown,
): MovementHistoryFilters {
  const record = isRecord(payload) ? payload : {};

  const page =
    typeof record.page === "number" &&
    Number.isInteger(record.page) &&
    record.page >= 1
      ? record.page
      : 1;
  const pageSize =
    typeof record.pageSize === "number" &&
    Number.isInteger(record.pageSize) &&
    record.pageSize >= 1
      ? Math.min(record.pageSize, 100)
      : 50;

  return {
    ean13:
      typeof record.ean13 === "string" && record.ean13.trim()
        ? record.ean13.trim()
        : undefined,
    fechaDesde:
      typeof record.fechaDesde === "string" && isIsoDate(record.fechaDesde)
        ? record.fechaDesde
        : undefined,
    fechaHasta:
      typeof record.fechaHasta === "string" && isIsoDate(record.fechaHasta)
        ? record.fechaHasta
        : undefined,
    tipo: validMovementTypes.has(record.tipo as MovementType)
      ? (record.tipo as MovementType)
      : undefined,
    loteId:
      typeof record.loteId === "string" && record.loteId.trim()
        ? record.loteId.trim()
        : undefined,
    page,
    pageSize,
    usuarioId:
      typeof record.usuarioId === "string"
        ? record.usuarioId.trim()
        : undefined,
  };
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeInteger(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
