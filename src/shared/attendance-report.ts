import { formatWorkedMinutes } from "./attendance";
import { parseMonthlySalesPeriod, type MonthlySalesPeriod } from "./monthly-sales";
import type { Role } from "./navigation";

export const ATTENDANCE_REPORT_PATH = "/app/reportes/asistencia-personal";
export const ATTENDANCE_REPORT_TYPE = "asistencia-personal";
export type AttendanceReportRequest = MonthlySalesPeriod & { rol?: Role };
export type AttendanceReportRow = {
  trabajadorId: number;
  nombreCompleto: string;
  rol: Role | null;
  diasTrabajados: number;
  ausenciasJustificadas: number;
  ausenciasInjustificadas: number;
  minutosTrabajados: number;
  promedioMinutosPorDia: number | null;
};
export type AttendanceReport = {
  periodo: MonthlySalesPeriod;
  rol: Role | null;
  filas: AttendanceReportRow[];
};
export type AttendanceReportExportRequest = {
  tipo: typeof ATTENDANCE_REPORT_TYPE;
  periodo: MonthlySalesPeriod;
  rol?: Role;
};

export function parseAttendanceReportRequest(payload: unknown): AttendanceReportRequest {
  const period = parseMonthlySalesPeriod(payload);
  const { rol } = payload as { rol?: unknown };
  if (rol !== undefined && rol !== "dueno" && rol !== "trabajador") {
    throw new RangeError("Seleccione un rol válido.");
  }
  return { ...period, ...(rol === undefined ? {} : { rol }) };
}

export function attendanceRoleLabel(role: Role | null): string {
  return role === "dueno" ? "Dueño" : role === "trabajador" ? "Trabajador" : "Sin usuario";
}

export function attendanceFilterLabel(role: Role | null): string {
  return role === null ? "Todos" : attendanceRoleLabel(role);
}

export const attendanceReportColumns = [
  "Nombre completo", "Rol", "Días trabajados", "Ausencias justificadas",
  "Ausencias injustificadas", "Horas trabajadas", "Promedio por día trabajado",
] as const;

export function attendanceReportValues(row: AttendanceReportRow): (string | number)[] {
  return [row.nombreCompleto, attendanceRoleLabel(row.rol), row.diasTrabajados,
    row.ausenciasJustificadas, row.ausenciasInjustificadas, formatWorkedMinutes(row.minutosTrabajados),
    row.promedioMinutosPorDia === null ? "N/A" : formatWorkedMinutes(row.promedioMinutosPorDia)];
}
