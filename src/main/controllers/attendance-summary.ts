import { sql } from 'drizzle-orm';
import type { DashboardAttendance, DashboardRequest } from '../../shared/dashboard';
import { loadAttendanceSummary, type DashboardDb } from './dashboard-queries';
import { getDashboardDay } from './dashboard-date';

/** Operación C23 compartida por dashboard y asistencia: identidad ya verificada. */
export async function loadAttendanceIndicator(
  database: DashboardDb, request: DashboardRequest, now = new Date(),
): Promise<DashboardAttendance> {
  if (request.role === 'dueno') {
    return { scope: 'global', ...await loadAttendanceSummary(database, now) };
  }
  const { startUtc, endUtc } = getDashboardDay(now);
  const users = await database.all<{ workerId: number }>(sql`
    SELECT trabajador_id AS workerId
    FROM usuario
    WHERE usuario_id = ${request.usuarioId}
  `);
  const user = users[0];
  if (!user) throw new Error('No se encontró el usuario de la sesión');
  const workers = await database.all<{ workerId: number; fullName: string }>(sql`
    SELECT trabajador_id AS workerId,
      trim(trabajador_nombre || ' ' || trabajador_apellido) AS fullName
    FROM trabajador
    WHERE trabajador_id = ${user.workerId} AND trabajador_estado = 'activo'
  `);
  const worker = workers[0];
  if (!worker) throw new Error('No se encontró el trabajador de la sesión');
  const entries = await database.all<{ enteredAt: string; exitedAt: string | null }>(sql`
    SELECT asistencia_fecha_hora_entrada AS enteredAt,
      asistencia_fecha_hora_salida AS exitedAt
    FROM asistencia WHERE trabajador_id = ${worker.workerId}
      AND datetime(asistencia_fecha_hora_entrada) >= datetime(${startUtc})
      AND datetime(asistencia_fecha_hora_entrada) < datetime(${endUtc})
    ORDER BY asistencia_fecha_hora_entrada DESC LIMIT 1
  `);
  return { scope: 'own', ...worker, enteredAt: entries[0]?.enteredAt ?? null,
    exitedAt: entries[0]?.exitedAt ?? null };
}
