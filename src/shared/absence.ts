import { getChileDateKey, isValidSaleHistoryDate } from "./sales";
import { normalizeRut } from "./rut";

export type AbsenceType = "justificada" | "injustificada";
export type AbsenceRequest = {
  trabajadorId: number;
  fecha: string;
  tipo: AbsenceType;
  observacion?: string | null;
};
export type AbsenceResult = {
  ausenciaId: string;
  trabajadorId: number;
  trabajadorNombre: string;
  fecha: string;
  tipo: AbsenceType;
  registradoAt: string;
};
export type AbsenceFieldErrors = Partial<Record<keyof AbsenceRequest, string>>;
export const ABSENCE_OBSERVATION_LIMIT = 200;

export function buildAbsenceCreatePath(rut?: string): string {
  const path = "/app/personal/ausencias/nueva";
  return rut ? `${path}?${new URLSearchParams({ trabajadorRut: normalizeRut(rut) })}` : path;
}

export function getAbsenceInitialRut(path: string): string | undefined {
  const value = new URLSearchParams(path.split("?")[1] ?? "").get("trabajadorRut");
  return value ? normalizeRut(value) : undefined;
}

export function countAbsenceObservation(value: string): number {
  return Array.from(value.trim()).length;
}

export function validateAbsenceRequest(
  payload: unknown,
  now = new Date(),
): { errors: AbsenceFieldErrors; values?: AbsenceRequest } {
  const input = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const errors: AbsenceFieldErrors = {};
  if (typeof input.trabajadorId !== "number" || !Number.isSafeInteger(input.trabajadorId) || input.trabajadorId <= 0) {
    errors.trabajadorId = "Seleccione un trabajador válido.";
  }
  if (!isValidSaleHistoryDate(input.fecha) || input.fecha.startsWith("0000-")) {
    errors.fecha = "Ingrese una fecha válida.";
  } else if (input.fecha > getChileDateKey(now)) {
    errors.fecha = "La fecha de ausencia no puede ser futura.";
  }
  if (input.tipo !== "justificada" && input.tipo !== "injustificada") {
    errors.tipo = "Seleccione Justificada o Injustificada.";
  }
  if (input.observacion != null && typeof input.observacion !== "string") {
    errors.observacion = "Ingrese una observación válida.";
  }
  const observacion = typeof input.observacion === "string" ? input.observacion.trim() : "";
  if (countAbsenceObservation(observacion) > ABSENCE_OBSERVATION_LIMIT) {
    errors.observacion = "La observación no puede superar los 200 caracteres.";
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    values: {
      trabajadorId: input.trabajadorId as number,
      fecha: input.fecha as string,
      tipo: input.tipo as AbsenceType,
      observacion: observacion || null,
    },
  };
}
