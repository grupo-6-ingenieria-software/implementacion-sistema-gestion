import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { findControllerById, type ControllerErrorCode } from "../../shared/controllers";
import {
  controllerError,
  controllerSuccess,
  type ControllerContext,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import { db } from "../../db/client";
import { isDashboardRequest } from "../../shared/dashboard";
import { type DashboardDb } from "./ConsultasDashboardAuxiliar";
import { loadAttendanceIndicator } from "./IndicadorAsistenciaAuxiliar";
import { notifyDashboardUpdated } from "./EventosDashboardAuxiliar";
import { registerAuditLog, type DbExecutor } from "./RegistroVentaAuxiliar";
import { runSerializedWriteTransaction } from "./TransaccionEscrituraAuxiliar";
import { addCalendarDays, getChileDateRange, getDashboardDay } from "./FechaChileAuxiliar";
import { AccessDeniedError, authorizeUser, mapDatabaseRoleToTechnicalRole } from "./ContextoAutenticacionAuxiliar";
import type { SessionTokenClaims } from "./TokenSesionAuxiliar";
import { INACTIVITY_MS } from "../../shared/auth";
import { validateAbsenceRequest, type AbsenceFieldErrors, type AbsenceResult } from "../../shared/absence";
import {
  formatWorkedHours,
  isValidRutFormat,
  normalizeRut,
  type AttendanceEntryResult,
  type AttendanceExitResult,
  type AttendanceRequest,
  type AttendanceWorkerOption,
  type AttendanceWorkerSummary,
} from "../../shared/attendance";
import type { Role } from "../../shared/navigation";
import {
  parseMonthlyAttendanceRequest,
  type MonthlyAttendanceRequest,
  type MonthlyAttendanceSummary,
  type MonthlyAttendanceWeek,
  type MonthlyAttendanceWorker,
} from "../../shared/monthly-attendance";
import { getWeekStartForDateKey } from "../../shared/shifts";
import {
  consolidateMonthlyAttendance,
  getMonthlyAttendanceBounds,
  MonthlyAttendanceError,
  type MonthlyAbsenceRow,
  type MonthlyAttendanceRow,
} from "./CalculoAsistenciaMensualAuxiliar";

const metadata = findControllerById("attendance")!;

/**
 * Canal `ausencia:registrar` de AsistenciaHandler (C23 / C50).
 * Conserva su propia validación de canal, rol y mensajes de error.
 */
export function createAbsenceController(
  register: typeof registerAbsence = registerAbsence,
  database: DbExecutor = db as unknown as DbExecutor,
): RegisteredController<unknown, AbsenceResult> {
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "ausencia:registrar") {
        return controllerError("INVALID_CHANNEL", "Canal de ausencia no válido.", metadata.id);
      }
      if (!context.claims || context.claims.rol !== "dueno") {
        return controllerError("FORBIDDEN", "No tiene permiso para registrar ausencias.", metadata.id);
      }
      try {
        return controllerSuccess(await register(database, payload, context.claims));
      } catch (error) {
        if (error instanceof AbsenceError) {
          return { ok: false, error: { code: error.code, message: error.message,
            controllerId: metadata.id, fieldErrors: error.fieldErrors } };
        }
        console.error("No fue posible registrar la ausencia", error);
        return controllerError("TECHNICAL_ERROR", "No fue posible registrar la ausencia. Intente nuevamente.", metadata.id);
      }
    },
  };
}

async function loadAuthorizedMonthlyAttendance(request: MonthlyAttendanceRequest, context: ControllerContext): Promise<MonthlyAttendanceSummary> {
  if (!context.claims || context.claims.rol !== "dueno") throw new AccessDeniedError();
  const { db, schema } = await import("../../db/client");
  await authorizeUser(db, schema, context.claims.usuarioId, ["dueno"], context.claims.rol);
  return queryMonthlyAttendance(db as unknown as DbExecutor, request);
}

/**
 * Canal `asistencia:resumen-mensual` de AsistenciaHandler (C23 / C51).
 * Conserva su propia validación de canal, rol y mensajes de error.
 */
export function createMonthlyAttendanceController(load = loadAuthorizedMonthlyAttendance): RegisteredController<unknown, MonthlyAttendanceSummary> {
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "asistencia:resumen-mensual") return controllerError("INVALID_CHANNEL", "Canal de resumen de asistencia no válido.", metadata.id);
      if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para consultar el resumen de asistencia.", metadata.id);
      try {
        return controllerSuccess(await load(parseMonthlyAttendanceRequest(payload), context));
      } catch (error) {
        if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message, metadata.id);
        if (error instanceof MonthlyAttendanceError) return controllerError(error.code, error.message, metadata.id);
        console.error("No fue posible consultar el resumen de asistencia", error);
        return controllerError("DATABASE_ERROR", "No fue posible consultar el resumen de asistencia. Intente nuevamente.", metadata.id);
      }
    },
  };
}

const absenceChannel = createAbsenceController();
const monthlyAttendanceChannel = createMonthlyAttendanceController();

export const asistenciaHandler: RegisteredController = {
  metadata,
  handle: async (payload, context) => {
    if (context.channel === "ausencia:registrar") {
      return absenceChannel.handle(payload, context);
    }

    if (context.channel === "asistencia:resumen-mensual") {
      return monthlyAttendanceChannel.handle(payload, context);
    }

    try {
      if (context.channel === "asistencia:resumen-dashboard") {
        const request = context.claims && {
          role: context.claims.rol,
          usuarioId: context.claims.usuarioId,
        };
        if (!isDashboardRequest(request)) {
          return controllerError(
            "VALIDATION_ERROR",
            "Se requiere una sesion valida para cargar el resumen de asistencia.",
            metadata.id,
          );
        }

        return controllerSuccess(
          await loadAttendanceIndicator(db as unknown as DashboardDb, request),
        );
      }

      if (context.channel === "asistencia:entrada") {
        const result = await registerAttendanceEntry(
          db as unknown as DbExecutor,
          payload ?? {},
        );

        if (result.status === "registered") {
          notifyDashboardUpdated();
        }

        return controllerSuccess(result);
      }

      if (context.channel === "asistencia:entrada-sin-turno") {
        const result = await registerAttendanceEntryWithoutShift(
          db as unknown as DbExecutor,
          payload ?? {},
        );
        if (result.status === "registered") {
          notifyDashboardUpdated();
        }
        return controllerSuccess(result);
      }

      if (context.channel === "asistencia:salida") {
        const result = await registerAttendanceExit(
          db as unknown as DbExecutor,
          payload ?? {},
        );
        if (result.status === "registered") {
          notifyDashboardUpdated();
        }
        return controllerSuccess(result);
      }

      return controllerError(
        "INVALID_CHANNEL",
        `Canal IPC no registrado: ${context.channel}`,
        metadata.id,
      );
    } catch (error) {
      if (error instanceof AttendanceValidationError) {
        return controllerError("VALIDATION_ERROR", error.message, metadata.id);
      }

      if (error instanceof AttendanceAccessError) {
        return controllerError("FORBIDDEN", error.message, metadata.id);
      }

      if (error instanceof AttendanceBusinessError) {
        return controllerError("BUSINESS_RULE", error.message, metadata.id);
      }

      console.error(error);
      return controllerError(
        "TECHNICAL_ERROR",
        "No fue posible procesar la asistencia. Intente nuevamente.",
        metadata.id,
      );
    }
  },
};

// Servicios de asistencia, ausencias y resumen mensual (absorbidos desde sus auxiliares).

export class AttendanceValidationError extends Error {}
export class AttendanceBusinessError extends Error {}
export class AttendanceAccessError extends Error {}

type AttendanceUser = {
  role: Role;
  usuarioId: string;
  usuarioRol: string;
  trabajadorId: number;
  trabajadorRut: string;
  nombreCompleto: string;
};

type WorkerRow = {
  trabajadorId: number;
  rut: string;
  nombreCompleto: string;
  estado: string;
};

type ShiftRow = {
  turnoId: string;
  turnoInicio: string;
  turnoFin: string;
};

type AttendanceRow = {
  asistenciaId: string;
  entradaAt: string;
  salidaAt: string | null;
};

export async function listActiveWorkers(
  database: Pick<DbExecutor, "all">,
  payload: unknown,
): Promise<AttendanceWorkerOption[]> {
  const usuarioId = getUsuarioId(payload);
  const user = await authorizeAttendanceUser(database, usuarioId);

  if (user.role !== "dueno") {
    return [
      {
        trabajadorId: user.trabajadorId,
        rut: user.trabajadorRut,
        nombreCompleto: user.nombreCompleto,
      },
    ];
  }

  const rows = await database.all<AttendanceWorkerOption>(sql`
    SELECT
      trabajador_id AS trabajadorId,
      trabajador_rut AS rut,
      trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto
    FROM trabajador
    WHERE trabajador_estado = 'activo'
    ORDER BY trabajador_nombre, trabajador_apellido
  `);

  return rows.map((row) => ({
    trabajadorId: Number(row.trabajadorId),
    rut: normalizeRut(row.rut),
    nombreCompleto: row.nombreCompleto,
  }));
}

export async function registerAttendanceEntry(
  database: DbExecutor,
  payload: AttendanceRequest,
  now = new Date(),
): Promise<AttendanceEntryResult> {
  return registerEntry(database, payload, false, now);
}

export async function registerAttendanceEntryWithoutShift(
  database: DbExecutor,
  payload: AttendanceRequest,
  now = new Date(),
): Promise<AttendanceEntryResult> {
  return registerEntry(database, payload, true, now);
}

export async function registerAttendanceExit(
  database: DbExecutor,
  payload: AttendanceRequest,
  now = new Date(),
): Promise<AttendanceExitResult> {
  const normalized = normalizeAttendanceRequest(payload);

  return database.transaction(async (tx) => {
    const user = await authorizeAttendanceUser(tx, normalized.usuarioId);
    const worker = await findWorkerByRut(tx, normalized.trabajadorRut);

    assertWorkerCanBeUsed(worker);
    assertCanOperateWorker(user, worker, "salida");

    const attendance = await findOpenTodayAttendance(
      tx,
      worker.trabajadorId,
      now,
    );

    if (!attendance) {
      const closedAttendance = await findTodayAttendance(
        tx,
        worker.trabajadorId,
        now,
      );

      if (closedAttendance?.salidaAt) {
        throw new AttendanceBusinessError(
          "Ya existe una salida registrada hoy para este trabajador",
        );
      }

      throw new AttendanceBusinessError(
        "No existe una entrada registrada hoy para este trabajador",
      );
    }

    if (normalized.fase === "prevalidar") {
      return {
        status: "ready_for_confirmation",
        asistenciaId: attendance.asistenciaId,
        entradaAt: attendance.entradaAt,
        trabajador: summarizeWorker(worker),
      };
    }

    const salidaAt = now.toISOString();
    const result = await tx.run(sql`
      UPDATE asistencia
      SET asistencia_fecha_hora_salida = ${salidaAt}
      WHERE asistencia_id = ${attendance.asistenciaId}
        AND asistencia_fecha_hora_salida IS NULL
    `);

    if (result.rowsAffected === 0) {
      throw new AttendanceBusinessError(
        "Ya existe una salida registrada hoy para este trabajador",
      );
    }

    await registerAuditLog(tx, {
      usuarioId: user.usuarioId,
      tipoAccion: "registrar_salida_asistencia",
      modulo: "personal",
      descripcion: `Salida de asistencia registrada para ${worker.nombreCompleto} por ${user.nombreCompleto}.`,
    });

    return {
      status: "registered",
      asistenciaId: attendance.asistenciaId,
      entradaAt: attendance.entradaAt,
      salidaAt,
      horasTrabajadas: formatWorkedHours(attendance.entradaAt, salidaAt),
      trabajador: summarizeWorker(worker),
    };
  });
}

async function registerEntry(
  database: DbExecutor,
  payload: AttendanceRequest,
  allowWithoutShift: boolean,
  now: Date,
): Promise<AttendanceEntryResult> {
  const normalized = normalizeAttendanceRequest(payload);

  return runSerializedWriteTransaction(database, async (tx) => {
    const user = await authorizeAttendanceUser(tx, normalized.usuarioId);
    const worker = await findWorkerByRut(tx, normalized.trabajadorRut);

    assertWorkerCanBeUsed(worker);
    assertCanOperateWorker(user, worker, "entrada");
    await assertNoAbsence(tx, worker.trabajadorId, now);

    const existing = await findTodayAttendance(tx, worker.trabajadorId, now);

    if (existing) {
      throw new AttendanceBusinessError(
        "Ya existe una entrada registrada hoy para este trabajador",
      );
    }

    const shift = await findTodayShift(tx, worker.trabajadorId, now);

    if (!shift && (normalized.fase === "prevalidar" || !allowWithoutShift)) {
      return {
        status: "requires_no_shift_confirmation",
        message:
          "El trabajador no tiene turno asignado para el dia de hoy. Desea registrar la entrada igualmente?",
        trabajador: summarizeWorker(worker),
      };
    }

    if (shift && allowWithoutShift) {
      throw new AttendanceBusinessError(
        "El trabajador ahora tiene un turno asignado. Vuelva a validar la entrada.",
      );
    }

    if (normalized.fase === "prevalidar") {
      return {
        status: "ready_for_confirmation",
        message: "Confirme el registro de entrada para este trabajador.",
        trabajador: summarizeWorker(worker, shift),
      };
    }

    const asistenciaId = randomUUID();
    const entradaAt = now.toISOString();

    await tx.run(sql`
      INSERT INTO asistencia (
        asistencia_id,
        asistencia_fecha_hora_entrada,
        asistencia_fecha_hora_salida,
        trabajador_id,
        turno_id
      )
      VALUES (
        ${asistenciaId},
        ${entradaAt},
        NULL,
        ${worker.trabajadorId},
        ${shift?.turnoId ?? null}
      )
    `);

    await registerAuditLog(tx, {
      usuarioId: user.usuarioId,
      tipoAccion: shift
        ? "registrar_entrada_asistencia"
        : "registrar_entrada_sin_turno",
      modulo: "personal",
      descripcion: `Entrada de asistencia registrada para ${worker.nombreCompleto} por ${user.nombreCompleto}.`,
    });

    return {
      status: "registered",
      asistenciaId,
      entradaAt,
      trabajador: summarizeWorker(worker, shift),
    };
  });
}

async function authorizeAttendanceUser(
  database: Pick<DbExecutor, "all">,
  usuarioId: string | undefined,
): Promise<AttendanceUser> {
  const normalizedUsuarioId = usuarioId?.trim();

  if (!normalizedUsuarioId) {
    throw new AttendanceValidationError(
      "Se requiere una sesion valida para registrar asistencia.",
    );
  }

  const accountRows = await database.all<{
    usuarioId: string;
    usuarioRol: string;
    trabajadorId: number;
  }>(sql`
    SELECT
      u.usuario_id AS usuarioId,
      u.usuario_rol AS usuarioRol,
      u.trabajador_id AS trabajadorId
    FROM usuario u
    WHERE u.usuario_id = ${normalizedUsuarioId}
    LIMIT 1
  `);
  const account = accountRows[0];

  if (!account) {
    throw new AttendanceAccessError(
      "El usuario autenticado no esta activo o no existe.",
    );
  }

  const workerRows = await database.all<{
    trabajadorId: number;
    trabajadorRut: string;
    trabajadorEstado: string;
    nombreCompleto: string;
  }>(sql`
    SELECT
      trabajador_id AS trabajadorId,
      trabajador_rut AS trabajadorRut,
      trabajador_estado AS trabajadorEstado,
      trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto
    FROM trabajador
    WHERE trabajador_id = ${account.trabajadorId}
    LIMIT 1
  `);
  const worker = workerRows[0];

  if (!worker || worker.trabajadorEstado !== "activo") {
    throw new AttendanceAccessError(
      "El usuario autenticado no esta activo o no existe.",
    );
  }

  const role = mapDatabaseRoleToTechnicalRole(account.usuarioRol);

  if (!role || !["dueno", "trabajador"].includes(role)) {
    throw new AttendanceAccessError(
      "No tiene permiso para registrar asistencia.",
    );
  }

  return {
    role,
    usuarioId: account.usuarioId,
    usuarioRol: account.usuarioRol,
    trabajadorId: Number(worker.trabajadorId),
    trabajadorRut: normalizeRut(worker.trabajadorRut),
    nombreCompleto: worker.nombreCompleto,
  };
}

function normalizeAttendanceRequest(
  payload: AttendanceRequest,
): Required<AttendanceRequest> {
  if (!payload || typeof payload !== "object") {
    throw new AttendanceValidationError(
      "Se requiere un trabajador para registrar asistencia.",
    );
  }

  const usuarioId = payload.usuarioId?.trim();
  const trabajadorRut = normalizeRut(payload.trabajadorRut ?? "");

  if (!usuarioId) {
    throw new AttendanceValidationError(
      "Se requiere una sesion valida para registrar asistencia.",
    );
  }

  if (!isValidRutFormat(trabajadorRut)) {
    throw new AttendanceValidationError("Ingrese un RUT valido.");
  }

  return {
    fase: payload.fase === "confirmar" ? "confirmar" : "prevalidar",
    usuarioId,
    trabajadorRut,
  };
}

async function findWorkerByRut(
  database: Pick<DbExecutor, "all">,
  trabajadorRut: string,
): Promise<WorkerRow | null> {
  const rutLookupKey = trabajadorRut.replace(/-/g, "");
  const rows = await database.all<WorkerRow>(sql`
    SELECT
      trabajador_id AS trabajadorId,
      trabajador_rut AS rut,
      trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto,
      trabajador_estado AS estado
    FROM trabajador
    WHERE replace(replace(replace(upper(trabajador_rut), '.', ''), '-', ''), ' ', '') = ${rutLookupKey}
    LIMIT 1
  `);

  return rows[0]
    ? {
        ...rows[0],
        trabajadorId: Number(rows[0].trabajadorId),
        rut: normalizeRut(rows[0].rut),
      }
    : null;
}

function assertWorkerCanBeUsed(
  worker: WorkerRow | null,
): asserts worker is WorkerRow {
  if (!worker) {
    throw new AttendanceBusinessError(
      "El trabajador no existe o no se encuentra registrado.",
    );
  }

  if (worker.estado !== "activo") {
    throw new AttendanceBusinessError(
      "Trabajador inactivo: no puede registrar asistencia",
    );
  }
}

function assertCanOperateWorker(
  user: AttendanceUser,
  worker: WorkerRow,
  action: "entrada" | "salida",
): void {
  if (user.role === "dueno") {
    return;
  }

  if (user.trabajadorId === worker.trabajadorId) {
    return;
  }

  throw new AttendanceAccessError(
    action === "entrada"
      ? "No tiene permisos para registrar la entrada de otro trabajador"
      : "No tiene permisos para registrar la salida de otro trabajador",
  );
}

async function assertNoAbsence(
  database: Pick<DbExecutor, "all">,
  trabajadorId: number,
  now: Date,
): Promise<void> {
  const { dateKey } = getDashboardDay(now);
  const rows = await database.all<{ ausenciaId: string }>(sql`
    SELECT ausencia_id AS ausenciaId
    FROM ausencia
    WHERE trabajador_id = ${trabajadorId}
      AND ausencia_fecha = ${dateKey}
    LIMIT 1
  `);

  if (rows[0]) {
    throw new AttendanceBusinessError(
      "El trabajador tiene una ausencia registrada para este dia.",
    );
  }
}

async function findTodayAttendance(
  database: Pick<DbExecutor, "all">,
  trabajadorId: number,
  now: Date,
): Promise<AttendanceRow | null> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<AttendanceRow>(sql`
    SELECT
      asistencia_id AS asistenciaId,
      asistencia_fecha_hora_entrada AS entradaAt,
      asistencia_fecha_hora_salida AS salidaAt
    FROM asistencia
    WHERE trabajador_id = ${trabajadorId}
      AND datetime(asistencia_fecha_hora_entrada) >= datetime(${startUtc})
      AND datetime(asistencia_fecha_hora_entrada) < datetime(${endUtc})
    ORDER BY datetime(asistencia_fecha_hora_entrada) DESC
    LIMIT 1
  `);

  return rows[0] ?? null;
}

async function findOpenTodayAttendance(
  database: Pick<DbExecutor, "all">,
  trabajadorId: number,
  now: Date,
): Promise<AttendanceRow | null> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<AttendanceRow>(sql`
    SELECT
      asistencia_id AS asistenciaId,
      asistencia_fecha_hora_entrada AS entradaAt,
      asistencia_fecha_hora_salida AS salidaAt
    FROM asistencia
    WHERE trabajador_id = ${trabajadorId}
      AND asistencia_fecha_hora_salida IS NULL
      AND datetime(asistencia_fecha_hora_entrada) >= datetime(${startUtc})
      AND datetime(asistencia_fecha_hora_entrada) < datetime(${endUtc})
    ORDER BY datetime(asistencia_fecha_hora_entrada) DESC
    LIMIT 1
  `);

  return rows[0] ?? null;
}

async function findTodayShift(
  database: Pick<DbExecutor, "all">,
  trabajadorId: number,
  now: Date,
): Promise<ShiftRow | null> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<ShiftRow>(sql`
    SELECT
      turno_id AS turnoId,
      turno_fecha_hora_inicio AS turnoInicio,
      turno_fecha_hora_fin AS turnoFin
    FROM turno
    WHERE trabajador_id = ${trabajadorId}
      AND turno_estado <> 'cancelado'
      AND datetime(turno_fecha_hora_inicio) < datetime(${endUtc})
      AND datetime(turno_fecha_hora_fin) > datetime(${startUtc})
    ORDER BY datetime(turno_fecha_hora_inicio) ASC
    LIMIT 1
  `);

  return rows[0] ?? null;
}

function summarizeWorker(
  worker: WorkerRow,
  shift?: ShiftRow | null,
): AttendanceWorkerSummary {
  return {
    trabajadorId: worker.trabajadorId,
    rut: worker.rut,
    nombreCompleto: worker.nombreCompleto,
    turnoId: shift?.turnoId,
    turnoInicio: shift?.turnoInicio,
    turnoFin: shift?.turnoFin,
  };
}

function getUsuarioId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "usuarioId" in payload &&
    typeof payload.usuarioId === "string"
  ) {
    return payload.usuarioId;
  }

  return undefined;
}

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
