import { isValidEan13, normalizeEan13 } from "./ean13";

export const SUPPLIER_ORDERS_UPDATED_EVENT = "pedido:actualizado";

export const supplierOrderStates = [
  "pendiente",
  "parcial",
  "recibido",
  "cancelado",
  "parcial_cerrado",
] as const;

export type SupplierOrderState = (typeof supplierOrderStates)[number];

export const supplierOrderStateLabels: Record<SupplierOrderState, string> = {
  pendiente: "Pendiente",
  parcial: "Recibido parcialmente",
  recibido: "Recibido",
  cancelado: "Cancelado",
  parcial_cerrado: "Cerrado con recepción parcial",
};

export type SupplierOrderCreateLine = {
  ean13: string;
  cantidad: number;
};

export type SupplierOrderCreatePayload = {
  proveedorId: number;
  lineas: SupplierOrderCreateLine[];
  usuarioId?: string;
};

export type SupplierOrderCreateResponse = {
  pedidoId: string;
  estado: "pendiente";
};

export type SupplierOrderListFilter = "abiertos" | "terminados" | "todos";

export type SupplierOrderListPayload = {
  estado?: SupplierOrderListFilter;
  usuarioId?: string;
};

export type SupplierOrderListItem = {
  pedidoId: string;
  fechaHoraEmision: string;
  estado: SupplierOrderState;
  proveedorId: number;
  proveedorNombre: string;
  totalSolicitado: number;
  totalRecibido: number;
  totalPendiente: number;
};

export type SupplierOrderDetailPayload = {
  pedidoId: string;
  usuarioId?: string;
};

export type SupplierOrderDetailLine = {
  detallePedidoId: string;
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  exigeVencimiento: boolean;
  cantidadSolicitada: number;
  cantidadRecibida: number;
  cantidadPendiente: number;
};

export type SupplierOrderReceptionLineHistory = {
  detallePedidoId: string;
  ean13: string;
  nombre: string;
  cantidad: number;
  loteId: string;
  precioCosto: number;
  fechaVencimiento: string | null;
};

export type SupplierOrderReceptionHistory = {
  recepcionId: string;
  operacionId: string;
  fechaHora: string;
  responsableId: string;
  responsableNombre: string;
  estadoResultante: "parcial" | "recibido";
  lineas: SupplierOrderReceptionLineHistory[];
};

export type SupplierOrderHistoryEvent = {
  id: string;
  tipo: string;
  fechaHora: string;
  nota: string | null;
  responsableId: string;
  responsableNombre: string;
};

export type SupplierOrderDetail = {
  pedidoId: string;
  fechaHoraEmision: string;
  estado: SupplierOrderState;
  proveedorId: number;
  proveedorNombre: string;
  proveedorRut: string;
  emisorId: string;
  lineas: SupplierOrderDetailLine[];
  recepciones: SupplierOrderReceptionHistory[];
  historial: SupplierOrderHistoryEvent[];
  puedeRecibir: boolean;
  puedeCancelar: boolean;
  puedeCerrarSaldo: boolean;
};

export type SupplierOrderReceptionLineInput = {
  detallePedidoId: string;
  cantidad: number;
  precioCosto?: number;
  fechaVencimiento?: string;
};

export type SupplierOrderReceptionPayload = {
  pedidoId: string;
  operacionId: string;
  lineas: SupplierOrderReceptionLineInput[];
  usuarioId?: string;
};

export type SupplierOrderReceptionResponse = {
  pedidoId: string;
  recepcionId: string;
  operacionId: string;
  estado: "parcial" | "recibido";
  idempotente: boolean;
};

export type SupplierOrderCancelPayload = {
  pedidoId: string;
  confirmacion: boolean;
  usuarioId?: string;
};

export type SupplierOrderClosePayload = {
  pedidoId: string;
  confirmacion: boolean;
  motivo: string;
  usuarioId?: string;
};

export type SupplierOrderFinishResponse = {
  pedidoId: string;
  estado: "cancelado" | "parcial_cerrado";
};

export type SupplierOrderFieldErrors = Partial<Record<string, string>>;

export function normalizeSupplierOrderCreatePayload(
  payload: unknown,
): SupplierOrderCreatePayload {
  const record = isRecord(payload) ? payload : {};
  const rawLines = Array.isArray(record.lineas) ? record.lineas : [];

  return {
    proveedorId: normalizeNumber(record.proveedorId),
    lineas: rawLines.map((line) => {
      const item = isRecord(line) ? line : {};
      return {
        ean13:
          typeof item.ean13 === "string" ? normalizeEan13(item.ean13) : "",
        cantidad: normalizeNumber(item.cantidad),
      };
    }),
    usuarioId: normalizeOptionalText(record.usuarioId),
  };
}

export function validateSupplierOrderCreatePayload(
  payload: SupplierOrderCreatePayload,
): SupplierOrderFieldErrors {
  const errors: SupplierOrderFieldErrors = {};

  if (!Number.isInteger(payload.proveedorId) || payload.proveedorId <= 0) {
    errors.proveedorId = "Seleccione un proveedor existente.";
  }

  if (payload.lineas.length === 0) {
    errors.lineas = "Agregue al menos un producto al pedido.";
  }

  const seen = new Map<string, number>();
  payload.lineas.forEach((line, index) => {
    if (!isValidEan13(line.ean13)) {
      errors[`lineas.${index}.ean13`] = "Ingrese un EAN-13 válido.";
    }

    if (!Number.isInteger(line.cantidad) || line.cantidad <= 0) {
      errors[`lineas.${index}.cantidad`] =
        "La cantidad debe ser un entero mayor que cero.";
    }

    const previous = seen.get(line.ean13);
    if (previous !== undefined) {
      const message = "Cada producto puede aparecer solo una vez.";
      errors[`lineas.${previous}.ean13`] = message;
      errors[`lineas.${index}.ean13`] = message;
    } else if (line.ean13) {
      seen.set(line.ean13, index);
    }
  });

  return errors;
}

export function normalizeSupplierOrderListPayload(
  payload: unknown,
): Required<SupplierOrderListPayload> {
  const record = isRecord(payload) ? payload : {};
  const estado =
    record.estado === "terminados" || record.estado === "todos"
      ? record.estado
      : "abiertos";

  return {
    estado,
    usuarioId: normalizeOptionalText(record.usuarioId) ?? "",
  };
}

export function normalizeSupplierOrderDetailPayload(
  payload: unknown,
): SupplierOrderDetailPayload {
  const record = isRecord(payload) ? payload : {};
  return {
    pedidoId: normalizeOptionalText(record.pedidoId) ?? "",
    usuarioId: normalizeOptionalText(record.usuarioId),
  };
}

export function normalizeSupplierOrderReceptionPayload(
  payload: unknown,
): SupplierOrderReceptionPayload {
  const record = isRecord(payload) ? payload : {};
  const rawLines = Array.isArray(record.lineas) ? record.lineas : [];

  return {
    pedidoId: normalizeOptionalText(record.pedidoId) ?? "",
    operacionId: normalizeOptionalText(record.operacionId) ?? "",
    lineas: rawLines.map((line) => {
      const item = isRecord(line) ? line : {};
      return {
        detallePedidoId:
          normalizeOptionalText(item.detallePedidoId) ?? "",
        cantidad: normalizeNumber(item.cantidad),
        precioCosto: normalizeOptionalNumber(item.precioCosto),
        fechaVencimiento: normalizeOptionalText(item.fechaVencimiento),
      };
    }),
    usuarioId: normalizeOptionalText(record.usuarioId),
  };
}

export function validateSupplierOrderReceptionShape(
  payload: SupplierOrderReceptionPayload,
): SupplierOrderFieldErrors {
  const errors: SupplierOrderFieldErrors = {};

  if (!isUuid(payload.pedidoId)) {
    errors.pedidoId = "Seleccione un pedido válido.";
  }

  if (!isUuid(payload.operacionId)) {
    errors.operacionId = "No fue posible identificar esta confirmación.";
  }

  if (payload.lineas.length === 0) {
    errors.lineas = "Ingrese las cantidades de esta entrega.";
  }

  const seen = new Set<string>();
  payload.lineas.forEach((line, index) => {
    if (!isUuid(line.detallePedidoId)) {
      errors[`lineas.${index}.detallePedidoId`] =
        "La línea del pedido no es válida.";
    } else if (seen.has(line.detallePedidoId)) {
      errors[`lineas.${index}.detallePedidoId`] =
        "La línea del pedido está repetida.";
    }
    seen.add(line.detallePedidoId);

    if (!Number.isInteger(line.cantidad) || line.cantidad < 0) {
      errors[`lineas.${index}.cantidad`] =
        "La cantidad debe ser un entero mayor o igual que cero.";
    }

    if (
      line.cantidad > 0 &&
      (!Number.isInteger(line.precioCosto) || Number(line.precioCosto) <= 0)
    ) {
      errors[`lineas.${index}.precioCosto`] =
        "El costo debe ser un entero mayor que cero.";
    }
  });

  if (!payload.lineas.some((line) => line.cantidad > 0)) {
    errors.lineas = "Ingrese al menos una cantidad positiva.";
  }

  return errors;
}

export function normalizeSupplierOrderCancelPayload(
  payload: unknown,
): SupplierOrderCancelPayload {
  const record = isRecord(payload) ? payload : {};
  return {
    pedidoId: normalizeOptionalText(record.pedidoId) ?? "",
    confirmacion: record.confirmacion === true,
    usuarioId: normalizeOptionalText(record.usuarioId),
  };
}

export function normalizeSupplierOrderClosePayload(
  payload: unknown,
): SupplierOrderClosePayload {
  const record = isRecord(payload) ? payload : {};
  return {
    pedidoId: normalizeOptionalText(record.pedidoId) ?? "",
    confirmacion: record.confirmacion === true,
    motivo: normalizeOptionalText(record.motivo) ?? "",
    usuarioId: normalizeOptionalText(record.usuarioId),
  };
}

export function hasSupplierOrderFieldErrors(
  errors: SupplierOrderFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const normalized = normalizeNumber(value);
  return Number.isNaN(normalized) ? undefined : normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
