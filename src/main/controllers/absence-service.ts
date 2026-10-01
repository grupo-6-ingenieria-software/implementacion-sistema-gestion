import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { validateAbsenceRequest, type AbsenceFieldErrors, type AbsenceResult } from "../../shared/absence";
import { INACTIVITY_MS } from "../../shared/auth";
import type { SessionTokenClaims } from "./auth-jwt";
import { mapDatabaseRoleToTechnicalRole } from "./auth-context";
import { getChileDateRange } from "./dashboard-date";
import { registerAuditLog, type DbExecutor } from "./sale-service";
import { runSerializedWriteTransaction } from "./write-transaction";
import type { ControllerErrorCode } from "../../shared/controllers";

export class AbsenceError extends Error {
  constructor(
    readonly code: ControllerErrorCode,
    message: string,
    readonly fieldErrors?: AbsenceFieldErrors,
  ) { super(message); }
}

export type AbsenceActor = Pick<SessionTokenClaims, "usuarioId" | "sesionId" | "rol">;

export async function registerAbsence(
  database: DbExecutor,
  payload: unknown,
  actor: AbsenceActor | undefined,
  now: () => Date = () => new Date(),
): Promise<AbsenceResult> {
  if (!actor || actor.rol !== "dueno" || !actor.usuarioId?.trim() || !actor.sesionId?.trim()) {
    throw new AbsenceError("FORBIDDEN", "No tiene permiso para registrar ausencias.");
  }
  try {
    return await runSerializedWriteTransaction(database, async (tx) => {
      const instant = now();
      const boundary = new Date(instant.getTime() - INACTIVITY_MS).toISOString();
      const [session] = await tx.all<{ usuarioId: string; rol: string | null; rolCuenta: string; estado: string }>(sql`
        SELECT s.usuario_id AS usuarioId, s.sesion_rol_efectivo AS rol,
          u.usuario_rol AS rolCuenta, t.trabajador_estado AS estado
        FROM sesion_usuario s
        JOIN usuario u ON u.usuario_id = s.usuario_id
        JOIN trabajador t ON t.trabajador_id = u.trabajador_id
        WHERE s.sesion_usuario_id = ${actor.sesionId}
          AND s.sesion_fecha_hora_cierre IS NULL
          AND julianday(s.sesion_fecha_hora_ultimo_acceso) > julianday(${boundary})
        LIMIT 1
      `);
      if (!session || session.usuarioId !== actor.usuarioId || session.estado !== "activo"
        || (session.rol ?? mapDatabaseRoleToTechnicalRole(session.rolCuenta)) !== "dueno") {
        throw new AbsenceError("FORBIDDEN", "No hay una sesión válida de Dueño para registrar ausencias.");
      }
      const { errors, values } = validateAbsenceRequest(payload, instant);
      if (!values) throw new AbsenceError("VALIDATION_ERROR", "Revise los campos marcados antes de continuar.", errors);

      const [worker] = await tx.all<{ nombre: string; estado: string }>(sql`
        SELECT trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombre,
          trabajador_estado AS estado FROM trabajador
        WHERE trabajador_id = ${values.trabajadorId} LIMIT 1
      `);
      if (!worker) throw new AbsenceError("NOT_FOUND", "El trabajador no existe.", { trabajadorId: "El trabajador no existe." });
      if (worker.estado !== "activo") throw new AbsenceError("BUSINESS_RULE", "No se puede registrar una ausencia para un trabajador inactivo.", { trabajadorId: "El trabajador está inactivo." });
      const [previous] = await tx.all(sql`
        SELECT ausencia_id FROM ausencia
        WHERE trabajador_id = ${values.trabajadorId} AND ausencia_fecha = ${values.fecha} LIMIT 1
      `);
      if (previous) throw duplicateAbsence();
      const { startUtc, endUtc } = getChileDateRange(values.fecha, values.fecha);
      const [attendance] = await tx.all(sql`
        SELECT asistencia_id FROM asistencia WHERE trabajador_id = ${values.trabajadorId}
          AND julianday(asistencia_fecha_hora_entrada) >= julianday(${startUtc})
          AND julianday(asistencia_fecha_hora_entrada) < julianday(${endUtc}) LIMIT 1
      `);
      if (attendance) throw new AbsenceError("BUSINESS_RULE", "El trabajador ya tiene asistencia registrada para esa fecha.", { fecha: "Ya existe asistencia para esta fecha." });
      const ausenciaId = randomUUID();
      const registradoAt = instant.toISOString();
      await tx.run(sql`
        INSERT INTO ausencia (ausencia_id, ausencia_fecha, ausencia_tipo, ausencia_observacion,
          ausencia_fecha_hora_registro, trabajador_id, usuario_registrador_id)
        VALUES (${ausenciaId}, ${values.fecha}, ${values.tipo}, ${values.observacion ?? null},
          ${registradoAt}, ${values.trabajadorId}, ${actor.usuarioId})
      `);
      await registerAuditLog(tx, {
        usuarioId: actor.usuarioId, tipoAccion: "registrar_ausencia", modulo: "personal",
        descripcion: `Ausencia ${values.tipo} registrada para ${worker.nombre} el ${values.fecha}.`,
      });
      return { ausenciaId, trabajadorId: values.trabajadorId, trabajadorNombre: worker.nombre,
        fecha: values.fecha, tipo: values.tipo, registradoAt };
    });
  } catch (error) {
    // Only this unique constraint represents a duplicate absence; other failures stay technical.
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (cause instanceof Error && !seen.has(cause)) {
      if (cause.message.includes("UNIQUE constraint failed: ausencia.trabajador_id, ausencia.ausencia_fecha")) {
        throw duplicateAbsence();
      }
      seen.add(cause);
      cause = cause.cause;
    }
    throw error;
  }
}

function duplicateAbsence(): AbsenceError {
  return new AbsenceError("BUSINESS_RULE", "El trabajador ya tiene una ausencia registrada para esa fecha.", { fecha: "Ya existe una ausencia para esta fecha." });
}
