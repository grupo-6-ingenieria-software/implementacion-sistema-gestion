import { sql } from "drizzle-orm";
import { parseAttendanceReportRequest, type AttendanceReport, type AttendanceReportRequest } from "../../shared/attendance-report";
import type { Role } from "../../shared/navigation";
import {
  consolidateMonthlyAttendance, getMonthlyAttendanceBounds, MonthlyAttendanceError,
  type MonthlyAttendanceRow, type MonthlyAbsenceRow,
} from "./monthly-attendance-calculation";
import type { DbExecutor } from "./sale-service";

type WorkerRow = { trabajadorId: number; nombreCompleto: string; estado: "activo" | "inactivo"; rol: Role | null };
type WorkerRecord<T> = T & { trabajadorId: number };

export async function queryAttendanceReport(
  database: Pick<DbExecutor, "transaction">,
  payload: AttendanceReportRequest,
): Promise<AttendanceReport> {
  const request = parseAttendanceReportRequest(payload);
  const { mes, anio } = request;
  const rol = request.rol ?? null;
  const { monthKey, firstDate, nextMonthDate, startUtc, endUtc } = getMonthlyAttendanceBounds(request);
  return database.transaction(async (tx) => {
    const roleFilter = rol === null ? sql`1 = 1` : sql`u.usuario_rol = ${rol}`;
    const workers = await tx.all<WorkerRow>(sql`
      SELECT t.trabajador_id AS trabajadorId,
        trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombreCompleto,
        t.trabajador_estado AS estado, u.usuario_rol AS rol
      FROM trabajador t LEFT JOIN usuario u ON u.trabajador_id = t.trabajador_id
      WHERE ${roleFilter}
    `);
    const attendances = await tx.all<WorkerRecord<MonthlyAttendanceRow>>(sql`
      SELECT a.trabajador_id AS trabajadorId, a.asistencia_id AS asistenciaId,
        a.asistencia_fecha_hora_entrada AS entradaAt, a.asistencia_fecha_hora_salida AS salidaAt
      FROM asistencia a LEFT JOIN usuario u ON u.trabajador_id = a.trabajador_id
      WHERE ${roleFilter} AND (
        (julianday(a.asistencia_fecha_hora_entrada) >= julianday(${startUtc})
          AND julianday(a.asistencia_fecha_hora_entrada) < julianday(${endUtc}))
        OR substr(a.asistencia_fecha_hora_entrada, 1, 7) = ${monthKey}
        OR julianday(a.asistencia_fecha_hora_entrada) IS NULL
      )
    `);
    const absences = await tx.all<WorkerRecord<MonthlyAbsenceRow>>(sql`
      SELECT a.trabajador_id AS trabajadorId, a.ausencia_fecha AS fecha, a.ausencia_tipo AS tipo
      FROM ausencia a LEFT JOIN usuario u ON u.trabajador_id = a.trabajador_id
      WHERE ${roleFilter} AND a.ausencia_fecha >= ${firstDate} AND a.ausencia_fecha < ${nextMonthDate}
    `);
    const attendanceByWorker = groupByWorker(attendances);
    const absenceByWorker = groupByWorker(absences);
    const filas: AttendanceReport["filas"] = [];
    let hasActivity = false;
    for (const worker of workers) {
      let summary;
      try {
        summary = consolidateMonthlyAttendance(request, attendanceByWorker.get(worker.trabajadorId) ?? [], absenceByWorker.get(worker.trabajadorId) ?? []);
      } catch (error) {
        if (error instanceof MonthlyAttendanceError) {
          throw new MonthlyAttendanceError(error.code, `${worker.nombreCompleto} (ID ${worker.trabajadorId}): ${error.message}`);
        }
        throw error;
      }
      const activity = summary.dias.length > 0;
      hasActivity ||= activity;
      if (worker.estado !== "activo" && !activity) continue;
      const closedDays = summary.dias.filter((day) => day.salidaAt !== null).length;
      filas.push({
        trabajadorId: Number(worker.trabajadorId), nombreCompleto: worker.nombreCompleto, rol: worker.rol,
        ...summary.totales,
        promedioMinutosPorDia: closedDays === 0 ? null : Math.floor(summary.totales.minutosTrabajados / closedDays),
      });
    }
    filas.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, "es-CL") || a.trabajadorId - b.trabajadorId);
    return { periodo: { mes, anio }, rol, filas: hasActivity ? filas : [] };
  });
}

function groupByWorker<T extends { trabajadorId: number }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const group = groups.get(row.trabajadorId) ?? [];
    group.push(row);
    groups.set(row.trabajadorId, group);
  }
  return groups;
}
