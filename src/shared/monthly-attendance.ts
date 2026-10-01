import { normalizeRut, type AttendanceWorkerOption } from "./attendance";

export const MONTHLY_ATTENDANCE_PATH = "/app/personal/asistencia/resumen-mensual";
export const MONTHLY_ATTENDANCE_EMPTY_MESSAGE = "No hay registros de asistencia ni ausencia en el período seleccionado.";

export type MonthlyAttendanceWorker = AttendanceWorkerOption & {
  estado: "activo" | "inactivo";
};
export type MonthlyAttendanceRequest = { trabajadorId: number; mes: number; anio: number };
export const monthlyAttendanceAbsenceTypes = ["justificada", "injustificada", "licencia", "vacaciones", "permiso"] as const;
export type MonthlyAttendanceAbsenceType = typeof monthlyAttendanceAbsenceTypes[number];
export type MonthlyAttendanceStatus = "presente" | "pendiente" | MonthlyAttendanceAbsenceType;
export type MonthlyAttendanceDay = {
  fecha: string;
  entradaAt: string | null;
  salidaAt: string | null;
  minutosTrabajados: number | null;
  estado: MonthlyAttendanceStatus;
};
export type MonthlyAttendanceWeek = {
  desde: string;
  hasta: string;
  minutosTrabajados: number;
};
export type MonthlyAttendanceSummary = {
  trabajador: MonthlyAttendanceWorker;
  periodo: { mes: number; anio: number };
  dias: MonthlyAttendanceDay[];
  totales: {
    diasTrabajados: number;
    minutosTrabajados: number;
    ausenciasJustificadas: number;
    ausenciasInjustificadas: number;
  };
  semanas: MonthlyAttendanceWeek[];
};

export const monthlyAttendanceStatusLabels: Record<MonthlyAttendanceStatus, string> = {
  presente: "Presente", pendiente: "Pendiente", justificada: "Justificada",
  injustificada: "Injustificada", licencia: "Licencia", vacaciones: "Vacaciones", permiso: "Permiso",
};

export function parseMonthlyAttendanceRequest(payload: unknown): MonthlyAttendanceRequest {
  const input = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  if (typeof input.trabajadorId !== "number" || !Number.isSafeInteger(input.trabajadorId) || input.trabajadorId <= 0) {
    throw new RangeError("Seleccione un trabajador válido.");
  }
  if (typeof input.mes !== "number" || !Number.isInteger(input.mes) || input.mes < 1 || input.mes > 12 ||
      typeof input.anio !== "number" || !Number.isInteger(input.anio) || input.anio < 1900 || input.anio > 9998) {
    throw new RangeError("Seleccione un mes y un año válidos.");
  }
  return { trabajadorId: input.trabajadorId, mes: input.mes, anio: input.anio };
}

export function buildMonthlyAttendancePath(rut?: string): string {
  return rut ? `${MONTHLY_ATTENDANCE_PATH}?${new URLSearchParams({ trabajadorRut: normalizeRut(rut) })}`
    : MONTHLY_ATTENDANCE_PATH;
}

export function getMonthlyAttendanceInitialRut(path: string): string | undefined {
  const value = new URLSearchParams(path.split("?")[1] ?? "").get("trabajadorRut");
  return value ? normalizeRut(value) : undefined;
}
