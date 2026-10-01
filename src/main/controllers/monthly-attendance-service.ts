import { sql } from "drizzle-orm";
import { getWorkedMinutes, normalizeRut } from "../../shared/attendance";
import type { ControllerErrorCode } from "../../shared/controllers";
import {
  monthlyAttendanceAbsenceTypes, parseMonthlyAttendanceRequest,
  type MonthlyAttendanceAbsenceType, type MonthlyAttendanceDay, type MonthlyAttendanceRequest,
  type MonthlyAttendanceSummary, type MonthlyAttendanceWeek, type MonthlyAttendanceWorker,
} from "../../shared/monthly-attendance";
import { getChileDateKey, isValidSaleHistoryDate } from "../../shared/sales";
import { getWeekStartForDateKey } from "../../shared/shifts";
import { addCalendarDays, getChileDateRange } from "./dashboard-date";
import type { DbExecutor } from "./sale-service";

export class MonthlyAttendanceError extends Error {
  constructor(public readonly code: ControllerErrorCode, message: string) { super(message); }
}

type AttendanceRow = { asistenciaId: string; entradaAt: string; salidaAt: string | null };
type AbsenceRow = { fecha: string; tipo: MonthlyAttendanceAbsenceType };

export async function queryMonthlyAttendance(
  database: Pick<DbExecutor, "all" | "transaction">,
  payload: MonthlyAttendanceRequest,
): Promise<MonthlyAttendanceSummary> {
  const request = parseMonthlyAttendanceRequest(payload);
  const { trabajadorId, mes, anio } = request;
  const monthKey = `${anio}-${String(mes).padStart(2, "0")}`;
  const firstDate = `${monthKey}-01`;
  const lastDate = `${monthKey}-${new Date(Date.UTC(anio, mes, 0)).getUTCDate()}`;
  const nextMonthDate = addCalendarDays(lastDate, 1);
  const { startUtc, endUtc } = getChileDateRange(firstDate, lastDate);

  // A single snapshot keeps the attendance and absence reads consistent.
  return database.transaction(async (tx) => {
    const [worker] = await tx.all<MonthlyAttendanceWorker>(sql`
      SELECT trabajador_id AS trabajadorId, trabajador_rut AS rut,
        trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto,
        trabajador_estado AS estado
      FROM trabajador WHERE trabajador_id = ${trabajadorId} LIMIT 1
    `);
    if (!worker) throw new MonthlyAttendanceError("NOT_FOUND", "El trabajador seleccionado no existe.");

    const attendances = await tx.all<AttendanceRow>(sql`
      SELECT asistencia_id AS asistenciaId, asistencia_fecha_hora_entrada AS entradaAt,
        asistencia_fecha_hora_salida AS salidaAt
      FROM asistencia WHERE trabajador_id = ${trabajadorId} AND (
        (julianday(asistencia_fecha_hora_entrada) >= julianday(${startUtc})
          AND julianday(asistencia_fecha_hora_entrada) < julianday(${endUtc}))
        OR substr(asistencia_fecha_hora_entrada, 1, 7) = ${monthKey}
        OR julianday(asistencia_fecha_hora_entrada) IS NULL
      )
    `);
    const absences = await tx.all<AbsenceRow>(sql`
      SELECT ausencia_fecha AS fecha, ausencia_tipo AS tipo FROM ausencia
      WHERE trabajador_id = ${trabajadorId}
        AND ausencia_fecha >= ${firstDate} AND ausencia_fecha < ${nextMonthDate}
    `);
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
    const semanas: MonthlyAttendanceWeek[] = [];
    for (let monday = getWeekStartForDateKey(firstDate); monday <= lastDate; monday = addCalendarDays(monday, 7)) {
      const sunday = addCalendarDays(monday, 6);
      semanas.push({ desde: monday < firstDate ? firstDate : monday, hasta: sunday > lastDate ? lastDate : sunday, minutosTrabajados: 0 });
    }
    const totales = { diasTrabajados: 0, minutosTrabajados: 0, ausenciasJustificadas: 0, ausenciasInjustificadas: 0 };
    for (const day of dias) {
      if (day.entradaAt !== null) totales.diasTrabajados++;
      else if (day.estado === "injustificada") totales.ausenciasInjustificadas++;
      else totales.ausenciasJustificadas++;
      const minutes = day.minutosTrabajados ?? 0;
      totales.minutosTrabajados += minutes;
      const week = semanas.find((item) => day.fecha >= item.desde && day.fecha <= item.hasta)!;
      week.minutosTrabajados += minutes;
    }
    return {
      trabajador: { ...worker, trabajadorId: Number(worker.trabajadorId), rut: normalizeRut(worker.rut) },
      periodo: { mes, anio }, dias, totales, semanas,
    };
  });
}

/** Legacy SQLite timestamps without an offset represent UTC, as in existing reports. */
function parseTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !isValidSaleHistoryDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const timestamp = value.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : `${timestamp}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
