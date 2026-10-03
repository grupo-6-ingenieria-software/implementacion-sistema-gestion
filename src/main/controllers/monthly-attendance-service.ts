import { sql } from "drizzle-orm";
import { normalizeRut } from "../../shared/attendance";
import {
  parseMonthlyAttendanceRequest, type MonthlyAttendanceRequest,
  type MonthlyAttendanceSummary, type MonthlyAttendanceWeek, type MonthlyAttendanceWorker,
} from "../../shared/monthly-attendance";
import { getWeekStartForDateKey } from "../../shared/shifts";
import { addCalendarDays } from "./dashboard-date";
import type { DbExecutor } from "./sale-service";
import {
  consolidateMonthlyAttendance, getMonthlyAttendanceBounds, MonthlyAttendanceError,
  type MonthlyAttendanceRow, type MonthlyAbsenceRow,
} from "./monthly-attendance-calculation";
export { MonthlyAttendanceError } from "./monthly-attendance-calculation";

export async function queryMonthlyAttendance(
  database: Pick<DbExecutor, "all" | "transaction">,
  payload: MonthlyAttendanceRequest,
): Promise<MonthlyAttendanceSummary> {
  const request = parseMonthlyAttendanceRequest(payload);
  const { trabajadorId, mes, anio } = request;
  const { monthKey, firstDate, lastDate, nextMonthDate, startUtc, endUtc } = getMonthlyAttendanceBounds(request);

  // A single snapshot keeps the attendance and absence reads consistent.
  return database.transaction(async (tx) => {
    const [worker] = await tx.all<MonthlyAttendanceWorker>(sql`
      SELECT trabajador_id AS trabajadorId, trabajador_rut AS rut,
        trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto,
        trabajador_estado AS estado
      FROM trabajador WHERE trabajador_id = ${trabajadorId} LIMIT 1
    `);
    if (!worker) throw new MonthlyAttendanceError("NOT_FOUND", "El trabajador seleccionado no existe.");

    const attendances = await tx.all<MonthlyAttendanceRow>(sql`
      SELECT asistencia_id AS asistenciaId, asistencia_fecha_hora_entrada AS entradaAt,
        asistencia_fecha_hora_salida AS salidaAt
      FROM asistencia WHERE trabajador_id = ${trabajadorId} AND (
        (julianday(asistencia_fecha_hora_entrada) >= julianday(${startUtc})
          AND julianday(asistencia_fecha_hora_entrada) < julianday(${endUtc}))
        OR substr(asistencia_fecha_hora_entrada, 1, 7) = ${monthKey}
        OR julianday(asistencia_fecha_hora_entrada) IS NULL
      )
    `);
    const absences = await tx.all<MonthlyAbsenceRow>(sql`
      SELECT ausencia_fecha AS fecha, ausencia_tipo AS tipo FROM ausencia
      WHERE trabajador_id = ${trabajadorId}
        AND ausencia_fecha >= ${firstDate} AND ausencia_fecha < ${nextMonthDate}
    `);
    const { dias, totales } = consolidateMonthlyAttendance(request, attendances, absences);
    const semanas: MonthlyAttendanceWeek[] = [];
    for (let monday = getWeekStartForDateKey(firstDate); monday <= lastDate; monday = addCalendarDays(monday, 7)) {
      const sunday = addCalendarDays(monday, 6);
      semanas.push({ desde: monday < firstDate ? firstDate : monday, hasta: sunday > lastDate ? lastDate : sunday, minutosTrabajados: 0 });
    }
    for (const day of dias) {
      const minutes = day.minutosTrabajados ?? 0;
      const week = semanas.find((item) => day.fecha >= item.desde && day.fecha <= item.hasta)!;
      week.minutosTrabajados += minutes;
    }
    return {
      trabajador: { ...worker, trabajadorId: Number(worker.trabajadorId), rut: normalizeRut(worker.rut) },
      periodo: { mes, anio }, dias, totales, semanas,
    };
  });
}
