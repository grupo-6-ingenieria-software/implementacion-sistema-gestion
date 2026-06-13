import { isValidEan13 } from './ean13';

export const wasteReasons = [
  'vencimiento',
  'dano',
  'robo',
  'error_registro',
] as const;

export type WasteReason = (typeof wasteReasons)[number];

export type WasteFieldErrors = Partial<
  Record<
    'ean13' | 'cantidad' | 'motivo' | 'observacion' | 'usuarioId',
    string
  >
>;

export type WasteRegisterPayload = {
  ean13: string;
  cantidad: number;
  motivo: WasteReason | '';
  observacion?: string;
  usuarioId?: string;
};

export type WasteDiscountedLot = {
  loteId: string;
  cantidad: number;
};

export type WasteRegisterResponse = {
  mermaId: string;
  ean13: string;
  cantidad: number;
  lotesDescontados: WasteDiscountedLot[];
};

export const invalidWasteEanMessage =
  'Seleccione un producto activo para registrar la merma.';

export function normalizeWasteRegisterPayload(
  payload: unknown,
): WasteRegisterPayload {
  const record = isRecord(payload) ? payload : {};
  const motivo = typeof record.motivo === 'string' ? record.motivo.trim() : '';
  const observacion =
    typeof record.observacion === 'string' ? record.observacion.trim() : '';

  return {
    ean13: typeof record.ean13 === 'string' ? record.ean13.trim() : '',
    cantidad: normalizeInteger(record.cantidad),
    motivo: isWasteReason(motivo) ? motivo : '',
    observacion: observacion.length > 0 ? observacion : undefined,
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
  };
}

export function validateWasteRegisterPayload(
  values: WasteRegisterPayload,
  options: { stockDisponible?: number; requireUser?: boolean } = {},
): WasteFieldErrors {
  const fieldErrors: WasteFieldErrors = {};

  if (!isValidEan13(values.ean13)) {
    fieldErrors.ean13 = invalidWasteEanMessage;
  }

  if (!Number.isInteger(values.cantidad) || values.cantidad <= 0) {
    fieldErrors.cantidad = 'La cantidad debe ser un entero mayor que 0.';
  } else if (
    options.stockDisponible !== undefined &&
    values.cantidad > options.stockDisponible
  ) {
    fieldErrors.cantidad = `La cantidad no puede superar el stock disponible (${options.stockDisponible}).`;
  }

  if (!isWasteReason(values.motivo)) {
    fieldErrors.motivo = 'Seleccione un motivo de merma valido.';
  }

  if (options.requireUser && !values.usuarioId) {
    fieldErrors.usuarioId = 'No hay un usuario responsable para registrar la merma.';
  }

  return fieldErrors;
}

export function hasWasteFieldErrors(errors: WasteFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function isWasteReason(value: string): value is WasteReason {
  return (wasteReasons as readonly string[]).includes(value);
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
