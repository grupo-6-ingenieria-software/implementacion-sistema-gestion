import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  isValidRutFormat,
  normalizeRut,
  type AttendanceEntryResult,
  type AttendanceExitResult,
  type AttendanceRequest,
  type AttendanceWorkerOption,
  type AttendanceWorkerSummary,
} from '../../shared/attendance';
import type { Role } from '../../shared/navigation';
import { getDashboardDay } from './dashboard-date';
import { mapDatabaseRoleToTechnicalRole } from './auth-context';
import { registerAuditLog, type DbExecutor } from './sale-service';

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
  database: Pick<DbExecutor, 'all'>,
  payload: unknown,
): Promise<AttendanceWorkerOption[]> {
  const usuarioId = getUsuarioId(payload);
  const user = await authorizeAttendanceUser(database, usuarioId);

  if (user.role !== 'dueno') {
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
    rut: row.rut,
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
    assertCanOperateWorker(user, worker, 'salida');

    const attendance = await findTodayAttendance(tx, worker.trabajadorId, now);

    if (!attendance) {
      throw new AttendanceBusinessError(
        'No existe una entrada registrada hoy para este trabajador',
      );
    }

    if (attendance.salidaAt) {
      throw new AttendanceBusinessError(
        'Ya existe una salida registrada hoy para este trabajador',
      );
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
        'Ya existe una salida registrada hoy para este trabajador',
      );
    }

    await registerAuditLog(tx, {
      usuarioId: user.usuarioId,
      tipoAccion: 'registrar_salida_asistencia',
      modulo: 'personal',
      descripcion: `Salida de asistencia registrada para ${worker.nombreCompleto} por ${user.nombreCompleto}.`,
    });

    return {
      status: 'registered',
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

  return database.transaction(async (tx) => {
    const user = await authorizeAttendanceUser(tx, normalized.usuarioId);
    const worker = await findWorkerByRut(tx, normalized.trabajadorRut);

    assertWorkerCanBeUsed(worker);
    assertCanOperateWorker(user, worker, 'entrada');
    await assertNoAbsence(tx, worker.trabajadorId, now);

    const existing = await findTodayAttendance(tx, worker.trabajadorId, now);

    if (existing) {
      throw new AttendanceBusinessError(
        'Ya existe una entrada registrada hoy para este trabajador',
      );
    }

    const shift = await findTodayShift(tx, worker.trabajadorId, now);

    if (!shift && !allowWithoutShift) {
      return {
        status: 'requires_no_shift_confirmation',
        message:
          'El trabajador no tiene turno asignado para el dia de hoy. Desea registrar la entrada igualmente?',
        trabajador: summarizeWorker(worker),
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
        ? 'registrar_entrada_asistencia'
        : 'registrar_entrada_sin_turno',
      modulo: 'personal',
      descripcion: `Entrada de asistencia registrada para ${worker.nombreCompleto} por ${user.nombreCompleto}.`,
    });

    return {
      status: 'registered',
      asistenciaId,
      entradaAt,
      trabajador: summarizeWorker(worker, shift),
    };
  });
}

async function authorizeAttendanceUser(
  database: Pick<DbExecutor, 'all'>,
  usuarioId: string | undefined,
): Promise<AttendanceUser> {
  const normalizedUsuarioId = usuarioId?.trim();

  if (!normalizedUsuarioId) {
    throw new AttendanceValidationError(
      'Se requiere una sesion valida para registrar asistencia.',
    );
  }

  const rows = await database.all<{
    usuarioId: string;
    usuarioRol: string;
    trabajadorId: number;
    trabajadorRut: string;
    trabajadorEstado: string;
    nombreCompleto: string;
  }>(sql`
    SELECT
      u.usuario_id AS usuarioId,
      u.usuario_rol AS usuarioRol,
      t.trabajador_id AS trabajadorId,
      t.trabajador_rut AS trabajadorRut,
      t.trabajador_estado AS trabajadorEstado,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombreCompleto
    FROM usuario u
    INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE u.usuario_id = ${normalizedUsuarioId}
    LIMIT 1
  `);
  const user = rows[0];

  if (!user || user.trabajadorEstado !== 'activo') {
    throw new AttendanceAccessError(
      'El usuario autenticado no esta activo o no existe.',
    );
  }

  const role = mapDatabaseRoleToTechnicalRole(user.usuarioRol);

  if (!role || !['dueno', 'trabajador'].includes(role)) {
    throw new AttendanceAccessError(
      'No tiene permiso para registrar asistencia.',
    );
  }

  return {
    role,
    usuarioId: user.usuarioId,
    usuarioRol: user.usuarioRol,
    trabajadorId: Number(user.trabajadorId),
    trabajadorRut: user.trabajadorRut,
    nombreCompleto: user.nombreCompleto,
  };
}

function normalizeAttendanceRequest(
  payload: AttendanceRequest,
): Required<AttendanceRequest> {
  if (!payload || typeof payload !== 'object') {
    throw new AttendanceValidationError(
      'Se requiere un trabajador para registrar asistencia.',
    );
  }

  const usuarioId = payload.usuarioId?.trim();
  const trabajadorRut = normalizeRut(payload.trabajadorRut ?? '');

  if (!usuarioId) {
    throw new AttendanceValidationError(
      'Se requiere una sesion valida para registrar asistencia.',
    );
  }

  if (!isValidRutFormat(trabajadorRut)) {
    throw new AttendanceValidationError('Ingrese un RUT valido.');
  }

  return { usuarioId, trabajadorRut };
}

async function findWorkerByRut(
  database: Pick<DbExecutor, 'all'>,
  trabajadorRut: string,
): Promise<WorkerRow | null> {
  const rows = await database.all<WorkerRow>(sql`
    SELECT
      trabajador_id AS trabajadorId,
      trabajador_rut AS rut,
      trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto,
      trabajador_estado AS estado
    FROM trabajador
    WHERE trabajador_rut = ${trabajadorRut}
    LIMIT 1
  `);

  return rows[0]
    ? {
        ...rows[0],
        trabajadorId: Number(rows[0].trabajadorId),
      }
    : null;
}

function assertWorkerCanBeUsed(worker: WorkerRow | null): asserts worker is WorkerRow {
  if (!worker) {
    throw new AttendanceBusinessError(
      'El trabajador no existe o no se encuentra registrado.',
    );
  }

  if (worker.estado !== 'activo') {
    throw new AttendanceBusinessError(
      'Trabajador inactivo: no puede registrar asistencia',
    );
  }
}

function assertCanOperateWorker(
  user: AttendanceUser,
  worker: WorkerRow,
  action: 'entrada' | 'salida',
): void {
  if (user.role === 'dueno') {
    return;
  }

  if (user.trabajadorId === worker.trabajadorId) {
    return;
  }

  throw new AttendanceAccessError(
    action === 'entrada'
      ? 'No tiene permisos para registrar la entrada de otro trabajador'
      : 'No tiene permisos para registrar la salida de otro trabajador',
  );
}

async function assertNoAbsence(
  database: Pick<DbExecutor, 'all'>,
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
      'El trabajador tiene una ausencia registrada para este dia.',
    );
  }
}

async function findTodayAttendance(
  database: Pick<DbExecutor, 'all'>,
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

async function findTodayShift(
  database: Pick<DbExecutor, 'all'>,
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

function formatWorkedHours(entradaAt: string, salidaAt: string): string {
  const diffMs = Math.max(0, Date.parse(salidaAt) - Date.parse(entradaAt));
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getUsuarioId(payload: unknown): string | undefined {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'usuarioId' in payload &&
    typeof payload.usuarioId === 'string'
  ) {
    return payload.usuarioId;
  }

  return undefined;
}
