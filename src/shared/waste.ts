import { isValidEan13 } from "./ean13";
import { parseIntegerInput } from "./numbers";

export const wasteReasons = [
  "vencimiento",
  "dano",
  "robo",
  "error_registro",
] as const;

export type WasteReason = (typeof wasteReasons)[number];

export type WasteFieldErrors = Partial<
  Record<"ean13" | "cantidad" | "motivo" | "observacion" | "usuarioId", string>
>;

export type WasteRegisterPayload = {
  ean13: string;
  cantidad: number;
  motivo: WasteReason | "";
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

export type WasteAvailabilityResponse = {
  ean13: string;
  stockDisponible: number;
  criterioSalida: "fefo" | "fecha_ingreso";
};

export const invalidWasteEanMessage =
  "Seleccione un producto activo para registrar la merma.";

export function normalizeWasteRegisterPayload(
  payload: unknown,
): WasteRegisterPayload {
  const record = isRecord(payload) ? payload : {};
  const motivo = typeof record.motivo === "string" ? record.motivo.trim() : "";
  const observacion =
    typeof record.observacion === "string" ? record.observacion.trim() : "";

  return {
    ean13: typeof record.ean13 === "string" ? record.ean13.trim() : "",
    cantidad: parseIntegerInput(record.cantidad),
    motivo: isWasteReason(motivo) ? motivo : "",
    observacion: observacion.length > 0 ? observacion : undefined,
    usuarioId:
      typeof record.usuarioId === "string"
        ? record.usuarioId.trim()
        : undefined,
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

  if (!Number.isSafeInteger(values.cantidad) || values.cantidad <= 0) {
    fieldErrors.cantidad = "La cantidad debe ser un entero mayor que 0.";
  } else if (
    options.stockDisponible !== undefined &&
    values.cantidad > options.stockDisponible
  ) {
    fieldErrors.cantidad = `La cantidad no puede superar el stock disponible (${options.stockDisponible}).`;
  }

  if (!isWasteReason(values.motivo)) {
    fieldErrors.motivo = "Seleccione un motivo de merma valido.";
  }

  if ((values.observacion?.length ?? 0) > 200) {
    fieldErrors.observacion = "La observacion no puede superar 200 caracteres.";
  }

  if (options.requireUser && !values.usuarioId) {
    fieldErrors.usuarioId =
      "No hay un usuario responsable para registrar la merma.";
  }

  return fieldErrors;
}

export function hasWasteFieldErrors(errors: WasteFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function isWasteReason(value: string): value is WasteReason {
  return (wasteReasons as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
