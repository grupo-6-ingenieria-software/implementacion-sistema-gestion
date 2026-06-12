export type LotFieldErrors = Partial<
  Record<
    | 'ean13'
    | 'cantidad'
    | 'precioCosto'
    | 'fechaVencimiento'
    | 'proveedorId'
    | 'usuarioId',
    string
  >
>;

export type LotProductOption = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  exigeVencimiento: boolean;
  stockDisponible: number;
};

export type LotProviderOption = {
  id: number;
  nombre: string;
  rut: string;
};

export type LotPreparePayload = {
  ean13?: string;
  query?: string;
  usuarioId?: string;
};

export type LotPrepareResponse = {
  providers: LotProviderOption[];
  product?: LotProductOption;
  products?: LotProductOption[];
};

export type LotRegisterPayload = {
  ean13: string;
  cantidad: number;
  precioCosto: number;
  fechaVencimiento?: string;
  proveedorId: number;
  usuarioId?: string;
};

export type LotRegisterResponse = {
  loteId: string;
  ean13: string;
};

export const invalidLotEanMessage =
  'Seleccione un producto activo para registrar el lote.';

export function normalizeLotPreparePayload(
  payload: unknown,
): LotPreparePayload {
  const record = isRecord(payload) ? payload : {};

  return {
    ean13: typeof record.ean13 === 'string' ? record.ean13.trim() : undefined,
    query: typeof record.query === 'string' ? record.query.trim() : undefined,
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
  };
}

export function normalizeLotRegisterPayload(
  payload: unknown,
): LotRegisterPayload {
  const record = isRecord(payload) ? payload : {};

  return {
    ean13: typeof record.ean13 === 'string' ? record.ean13.trim() : '',
    cantidad: normalizeInteger(record.cantidad),
    precioCosto: normalizeInteger(record.precioCosto),
    fechaVencimiento:
      typeof record.fechaVencimiento === 'string'
        ? record.fechaVencimiento.trim()
        : undefined,
    proveedorId: normalizeInteger(record.proveedorId),
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
  };
}

export function validateLotRegisterPayload(
  values: LotRegisterPayload,
  options: { productRequiresExpiration?: boolean; today?: string } = {},
): LotFieldErrors {
  const fieldErrors: LotFieldErrors = {};

  if (!/^\d{13}$/.test(values.ean13)) {
    fieldErrors.ean13 = invalidLotEanMessage;
  }

  if (!Number.isInteger(values.cantidad) || values.cantidad <= 0) {
    fieldErrors.cantidad = 'La cantidad debe ser un entero mayor que 0.';
  }

  if (!Number.isInteger(values.precioCosto) || values.precioCosto <= 0) {
    fieldErrors.precioCosto = 'El costo del lote debe ser un entero mayor que 0.';
  }

  if (!Number.isInteger(values.proveedorId) || values.proveedorId <= 0) {
    fieldErrors.proveedorId = 'Seleccione un proveedor existente.';
  }

  if (options.productRequiresExpiration) {
    const today = options.today ?? getTodayIsoDate();

    if (!values.fechaVencimiento) {
      fieldErrors.fechaVencimiento =
        'La fecha de vencimiento es obligatoria para esta categoria.';
    } else if (!isIsoDate(values.fechaVencimiento)) {
      fieldErrors.fechaVencimiento = 'Ingrese una fecha de vencimiento valida.';
    } else if (values.fechaVencimiento <= today) {
      fieldErrors.fechaVencimiento =
        'La fecha de vencimiento debe ser posterior a hoy.';
    }
  }

  return fieldErrors;
}

export function hasLotFieldErrors(errors: LotFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function getTodayIsoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeInteger(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
  }

  return Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
