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
    // Rol vigente al cierre del período según UsuarioVersion (CU52, pasos 23-24).
    // Las versiones se crean al primer registro auditado: sin una anterior al cierre,
    // la más antigua conocida y, sin versiones, el rol actual de Usuario.
    const workers = await tx.all<WorkerRow>(sql`
      SELECT t.trabajador_id AS trabajadorId,
        trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombreCompleto,
        t.trabajador_estado AS estado,
        CASE WHEN u.usuario_id IS NULL THEN NULL ELSE coalesce(
          (SELECT uv.usuario_version_rol FROM usuario_version uv
            WHERE uv.usuario_id = u.usuario_id
              AND julianday(uv.usuario_version_fecha_hora_vigencia_desde) < julianday(${endUtc})
            ORDER BY julianday(uv.usuario_version_fecha_hora_vigencia_desde) DESC,
              uv.usuario_version_fecha_hora_vigencia_hasta IS NULL DESC
            LIMIT 1),
          (SELECT uv.usuario_version_rol FROM usuario_version uv
            WHERE uv.usuario_id = u.usuario_id
            ORDER BY julianday(uv.usuario_version_fecha_hora_vigencia_desde) ASC
            LIMIT 1),
          u.usuario_rol) END AS rol
      FROM trabajador t LEFT JOIN usuario u ON u.trabajador_id = t.trabajador_id
    `);
    const attendances = await tx.all<WorkerRecord<MonthlyAttendanceRow>>(sql`
      SELECT trabajador_id AS trabajadorId, asistencia_id AS asistenciaId,
        asistencia_fecha_hora_entrada AS entradaAt, asistencia_fecha_hora_salida AS salidaAt
      FROM asistencia
      WHERE (julianday(asistencia_fecha_hora_entrada) >= julianday(${startUtc})
          AND julianday(asistencia_fecha_hora_entrada) < julianday(${endUtc}))
        OR substr(asistencia_fecha_hora_entrada, 1, 7) = ${monthKey}
        OR julianday(asistencia_fecha_hora_entrada) IS NULL
    `);
    const absences = await tx.all<WorkerRecord<MonthlyAbsenceRow>>(sql`
      SELECT trabajador_id AS trabajadorId, ausencia_fecha AS fecha, ausencia_tipo AS tipo
      FROM ausencia
      WHERE ausencia_fecha >= ${firstDate} AND ausencia_fecha < ${nextMonthDate}
    `);
    const attendanceByWorker = groupByWorker(attendances);
    const absenceByWorker = groupByWorker(absences);
    const filas: AttendanceReport["filas"] = [];
    let hasActivity = false;
    for (const worker of workers) {
      if (rol !== null && worker.rol !== rol) continue;
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
      filas.push({
        trabajadorId: Number(worker.trabajadorId), nombreCompleto: worker.nombreCompleto, rol: worker.rol,
        ...summary.totales,
        // Promedio = horas / días trabajados; sin días trabajados, N/A (paso 34).
        promedioMinutosPorDia: summary.totales.diasTrabajados === 0
          ? null : Math.floor(summary.totales.minutosTrabajados / summary.totales.diasTrabajados),
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
