import { getWorkedMinutes } from "../../shared/attendance";
import type { ControllerErrorCode } from "../../shared/controllers";
import {
  monthlyAttendanceAbsenceTypes, type MonthlyAttendanceAbsenceType,
  type MonthlyAttendanceDay, type MonthlyAttendanceSummary,
} from "../../shared/monthly-attendance";
import type { MonthlySalesPeriod } from "../../shared/monthly-sales";
import { getChileDateKey, isValidSaleHistoryDate } from "../../shared/sales";
import { addCalendarDays, getChileDateRange } from "./dashboard-date";

export class MonthlyAttendanceError extends Error {
  constructor(public readonly code: ControllerErrorCode, message: string) { super(message); }
}

export type MonthlyAttendanceRow = { asistenciaId: string; entradaAt: string; salidaAt: string | null };
export type MonthlyAbsenceRow = { fecha: string; tipo: MonthlyAttendanceAbsenceType };

export function getMonthlyAttendanceBounds({ mes, anio }: MonthlySalesPeriod) {
  const monthKey = `${anio}-${String(mes).padStart(2, "0")}`;
  const firstDate = `${monthKey}-01`;
  const lastDate = `${monthKey}-${new Date(Date.UTC(anio, mes, 0)).getUTCDate()}`;
  return { monthKey, firstDate, lastDate, nextMonthDate: addCalendarDays(lastDate, 1), ...getChileDateRange(firstDate, lastDate) };
}

/** Shared CU33/CU52 rules, independent of querying and weekly presentation. */
export function consolidateMonthlyAttendance(
  period: MonthlySalesPeriod,
  attendances: readonly MonthlyAttendanceRow[],
  absences: readonly MonthlyAbsenceRow[],
): Pick<MonthlyAttendanceSummary, "dias" | "totales"> {
  const { monthKey, firstDate, lastDate } = getMonthlyAttendanceBounds(period);
  const days = new Map<string, MonthlyAttendanceDay>();
  const conflicts = new Set<string>();
  for (const row of attendances) {
    const entradaAt = parseTimestamp(row.entradaAt);
    if (!entradaAt) {
      // Recognizable corruption in another month does not block this period.
      if (/^\d{4}-(?:0[1-9]|1[0-2])-/.test(row.entradaAt) && !row.entradaAt.startsWith(monthKey)) continue;
      conflicts.add(/^\d{4}-\d{2}-\d{2}/.exec(row.entradaAt)?.[0] ?? `fecha desconocida (asistencia ${row.asistenciaId})`);
      continue;
    }
    const fecha = getChileDateKey(new Date(entradaAt));
    if (fecha < firstDate || fecha > lastDate) continue;
    const salidaAt = row.salidaAt === null ? null : parseTimestamp(row.salidaAt);
    if (days.has(fecha) || (row.salidaAt !== null && (!salidaAt || Date.parse(salidaAt) < Date.parse(entradaAt)))) {
      conflicts.add(fecha);
      continue;
    }
    days.set(fecha, {
      fecha, entradaAt, salidaAt,
      minutosTrabajados: salidaAt === null ? null : getWorkedMinutes(entradaAt, salidaAt),
      estado: salidaAt === null ? "pendiente" : "presente",
    });
  }
  for (const row of absences) {
    if (!isValidSaleHistoryDate(row.fecha) || days.has(row.fecha) ||
        !(monthlyAttendanceAbsenceTypes as readonly string[]).includes(row.tipo)) {
      conflicts.add(row.fecha);
      continue;
    }
    days.set(row.fecha, { fecha: row.fecha, entradaAt: null, salidaAt: null, minutosTrabajados: null, estado: row.tipo });
  }
  if (conflicts.size) {
    throw new MonthlyAttendanceError("BUSINESS_RULE",
      `No se puede generar el resumen: existen registros inconsistentes en ${[...conflicts].sort().join(", ")}. Revise los registros de origen.`);
  }
  const dias = [...days.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const totales = { diasTrabajados: 0, minutosTrabajados: 0, ausenciasJustificadas: 0, ausenciasInjustificadas: 0 };
  for (const day of dias) {
    if (day.entradaAt !== null) totales.diasTrabajados++;
    else if (day.estado === "injustificada") totales.ausenciasInjustificadas++;
    else totales.ausenciasJustificadas++;
    totales.minutosTrabajados += day.minutosTrabajados ?? 0;
  }
  return { dias, totales };
}

/** Legacy SQLite timestamps without an offset represent UTC, as in existing reports. */
function parseTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !isValidSaleHistoryDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const timestamp = value.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : `${timestamp}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
