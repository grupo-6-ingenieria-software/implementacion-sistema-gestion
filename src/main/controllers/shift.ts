import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import {
  addDaysToDateKey,
  formatShiftTimestamp,
  hasShiftFieldErrors,
  normalizeShiftCreatePayload,
  normalizeShiftDeletePayload,
  normalizeShiftEditPayload,
  normalizeShiftListPayload,
  parseShiftRange,
  validateShiftCreatePayload,
  validateShiftDeletePayload,
  validateShiftEditPayload,
  validateShiftListPayload,
  type ShiftCalendarItem,
  type ShiftCreatePayload,
  type ShiftDeletePayload,
  type ShiftEditPayload,
  type ShiftFieldErrors,
  type ShiftListPayload,
  type ShiftListResponse,
  type ShiftMutationResponse,
} from '../../shared/shifts';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import { db, schema } from '../../db/client';
import { authorizeUser } from './auth-context';
import { registerAuditLog, type DbExecutor } from './sale-service';

const metadata = controllers[21];

export type ShiftActor = {
  role: 'dueno';
  usuarioId: string;
};

type ShiftRow = {
  turnoId: string;
  inicioAt: string;
  terminoAt: string;
  trabajadorId: number;
  trabajadorNombre: string;
  asistenciaCount: number;
};

export class ShiftValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: ShiftFieldErrors = {},
  ) {
    super(message);
  }
}

export class ShiftBusinessError extends Error {}
export class ShiftAccessError extends Error {}

export const shiftController: RegisteredController = {
  metadata,
  handle: async (payload, context) => {
    try {
      if (context.channel === 'turno:listar') {
        const input = normalizeShiftListPayload(payload);
        assertValid(validateShiftListPayload(input));
        const actor = await requireOwner(input.usuarioId);
        return controllerSuccess(
          await listShifts(db as unknown as DbExecutor, input, actor),
        );
      }

      if (context.channel === 'turno:crear') {
        const input = normalizeShiftCreatePayload(payload);
        assertValid(validateShiftCreatePayload(input));
        const actor = await requireOwner(input.usuarioId);
        return controllerSuccess(
          await createShift(db as unknown as DbExecutor, input, actor),
        );
      }

      if (context.channel === 'turno:editar') {
        const input = normalizeShiftEditPayload(payload);
        assertValid(validateShiftEditPayload(input));
        const actor = await requireOwner(input.usuarioId);
        return controllerSuccess(
          await editShift(db as unknown as DbExecutor, input, actor),
        );
      }

      if (context.channel === 'turno:eliminar') {
        const input = normalizeShiftDeletePayload(payload);
        assertValid(validateShiftDeletePayload(input));
        const actor = await requireOwner(input.usuarioId);
        return controllerSuccess(
          await deleteShift(db as unknown as DbExecutor, input, actor),
        );
      }

      return controllerError(
        'INVALID_CHANNEL',
        `Canal IPC no registrado: ${context.channel}`,
        metadata.id,
      );
    } catch (error) {
      if (error instanceof ShiftValidationError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            controllerId: metadata.id,
            fieldErrors: error.fieldErrors,
            message: error.message,
          },
        };
      }

      if (error instanceof ShiftAccessError) {
        return controllerError('FORBIDDEN', error.message, metadata.id);
      }

      if (error instanceof ShiftBusinessError) {
        return controllerError('BUSINESS_RULE', error.message, metadata.id);
      }

      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible procesar los turnos. Intente nuevamente.',
        metadata.id,
      );
    }
  },
};

export async function listShifts(
  database: DbExecutor,
  payload: ShiftListPayload,
  actor: ShiftActor,
  now = new Date(),
): Promise<ShiftListResponse> {
  assertOwnerActor(actor);
  const finSemana = addDaysToDateKey(payload.inicioSemana, 6);
  const finExclusivo = addDaysToDateKey(payload.inicioSemana, 7);
  const startAt = `${payload.inicioSemana}T00:00:00.000Z`;
  const endAt = `${finExclusivo}T23:59:59.999Z`;
  const workerFilter = payload.trabajadorId
    ? sql`AND t.trabajador_id = ${payload.trabajadorId}`
    : sql``;
  const rows = await database.all<ShiftRow>(sql`
    SELECT
      tu.turno_id AS turnoId,
      tu.turno_fecha_hora_inicio AS inicioAt,
      tu.turno_fecha_hora_fin AS terminoAt,
      t.trabajador_id AS trabajadorId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS trabajadorNombre,
      (SELECT COUNT(*) FROM asistencia a WHERE a.turno_id = tu.turno_id) AS asistenciaCount
    FROM turno tu
    INNER JOIN trabajador t ON t.trabajador_id = tu.trabajador_id
    WHERE datetime(tu.turno_fecha_hora_inicio) >= datetime(${startAt})
      AND datetime(tu.turno_fecha_hora_inicio) <= datetime(${endAt})
      AND t.trabajador_estado = 'activo'
      ${workerFilter}
    ORDER BY datetime(tu.turno_fecha_hora_inicio), trabajadorNombre
  `);

  const turnos = rows
    .map((row) => mapShiftRow(row, now))
    .filter(
      (turno) =>
        turno.fechaIso >= payload.inicioSemana &&
        turno.fechaIso <= finSemana,
    );

  return {
    inicioSemana: payload.inicioSemana,
    finSemana,
    turnos,
  };
}

export async function createShift(
  database: DbExecutor,
  payload: ShiftCreatePayload,
  actor: ShiftActor,
): Promise<ShiftMutationResponse> {
  const range = requireRange(payload);

  return database.transaction(async (tx) => {
    assertOwnerActor(actor);
    const worker = await findActiveWorker(tx, payload.trabajadorId);

    if (!worker) {
      throw new ShiftValidationError('Revise los campos marcados.', {
        trabajadorId: 'Seleccione un trabajador activo.',
      });
    }

    await assertNoOverlap(
      tx,
      payload.trabajadorId,
      range.inicioAt,
      range.terminoAt,
    );

    const turnoId = randomUUID();
    await tx.run(sql`
      INSERT INTO turno (
        turno_id,
        turno_fecha_hora_inicio,
        turno_fecha_hora_fin,
        turno_estado,
        trabajador_id
      )
      VALUES (
        ${turnoId},
        ${range.inicioAt},
        ${range.terminoAt},
        'planificado',
        ${payload.trabajadorId}
      )
    `);

    await registerAuditLog(tx, {
      usuarioId: actor.usuarioId,
      tipoAccion: 'crear_turno',
      modulo: 'personal',
      descripcion: `Turno creado para ${worker.nombreCompleto}: ${payload.fecha} ${payload.horaInicio}-${payload.horaTermino}.`,
    });

    return { turnoId };
  });
}

export async function editShift(
  database: DbExecutor,
  payload: ShiftEditPayload,
  actor: ShiftActor,
  now = new Date(),
): Promise<ShiftMutationResponse> {
  const range = requireRange(payload);

  return database.transaction(async (tx) => {
    assertOwnerActor(actor);
    const existing = await findShift(tx, payload.turnoId);

    assertShiftCanChange(existing, now, 'modificar');
    await assertNoOverlap(
      tx,
      existing.trabajadorId,
      range.inicioAt,
      range.terminoAt,
      payload.turnoId,
    );

    await tx.run(sql`
      UPDATE turno
      SET
        turno_fecha_hora_inicio = ${range.inicioAt},
        turno_fecha_hora_fin = ${range.terminoAt}
      WHERE turno_id = ${payload.turnoId}
    `);

    await registerAuditLog(tx, {
      usuarioId: actor.usuarioId,
      tipoAccion: 'editar_turno',
      modulo: 'personal',
      descripcion: `Turno de ${existing.trabajadorNombre} reprogramado a ${payload.fecha} ${payload.horaInicio}-${payload.horaTermino}.`,
    });

    return { turnoId: payload.turnoId };
  });
}

export async function deleteShift(
  database: DbExecutor,
  payload: ShiftDeletePayload,
  actor: ShiftActor,
  now = new Date(),
): Promise<ShiftMutationResponse> {
  if (!payload.confirmacion) {
    throw new ShiftValidationError(
      'Debe confirmar la eliminacion del turno.',
      {
        confirmacion: 'Debe confirmar la eliminacion del turno.',
      },
    );
  }

  return database.transaction(async (tx) => {
    assertOwnerActor(actor);
    const existing = await findShift(tx, payload.turnoId);

    assertShiftCanChange(existing, now, 'eliminar');
    await registerAuditLog(tx, {
      usuarioId: actor.usuarioId,
      tipoAccion: 'eliminar_turno',
      modulo: 'personal',
      descripcion: `Turno de ${existing.trabajadorNombre} eliminado (${existing.inicioAt} - ${existing.terminoAt}).`,
    });
    await tx.run(sql`DELETE FROM turno WHERE turno_id = ${payload.turnoId}`);

    return { turnoId: payload.turnoId };
  });
}

async function requireOwner(usuarioId: string | undefined): Promise<ShiftActor> {
  try {
    const user = await authorizeUser(db, schema, usuarioId, ['dueno']);
    return {
      role: 'dueno',
      usuarioId: user.usuarioId,
    };
  } catch {
    throw new ShiftAccessError('No tiene permiso para gestionar turnos.');
  }
}

function assertOwnerActor(actor: ShiftActor): void {
  if (!actor.usuarioId?.trim() || actor.role !== 'dueno') {
    throw new ShiftAccessError('No tiene permiso para gestionar turnos.');
  }
}

async function findActiveWorker(
  database: Pick<DbExecutor, 'all'>,
  trabajadorId: number,
): Promise<{ nombreCompleto: string } | null> {
  const rows = await database.all<{ nombreCompleto: string }>(sql`
    SELECT trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombreCompleto
    FROM trabajador
    WHERE trabajador_id = ${trabajadorId}
      AND trabajador_estado = 'activo'
    LIMIT 1
  `);

  return rows[0] ?? null;
}

async function findShift(
  database: Pick<DbExecutor, 'all'>,
  turnoId: string,
): Promise<ShiftRow | null> {
  const rows = await database.all<ShiftRow>(sql`
    SELECT
      tu.turno_id AS turnoId,
      tu.turno_fecha_hora_inicio AS inicioAt,
      tu.turno_fecha_hora_fin AS terminoAt,
      t.trabajador_id AS trabajadorId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS trabajadorNombre,
      (SELECT COUNT(*) FROM asistencia a WHERE a.turno_id = tu.turno_id) AS asistenciaCount
    FROM turno tu
    INNER JOIN trabajador t ON t.trabajador_id = tu.trabajador_id
    WHERE tu.turno_id = ${turnoId}
    LIMIT 1
  `);

  return rows[0] ?? null;
}

async function assertNoOverlap(
  database: Pick<DbExecutor, 'all'>,
  trabajadorId: number,
  inicioAt: string,
  terminoAt: string,
  excludedShiftId?: string,
): Promise<void> {
  const exclusion = excludedShiftId
    ? sql`AND turno_id <> ${excludedShiftId}`
    : sql``;
  const rows = await database.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count
    FROM turno
    WHERE trabajador_id = ${trabajadorId}
      AND turno_estado <> 'cancelado'
      AND datetime(${inicioAt}) < datetime(turno_fecha_hora_fin)
      AND datetime(${terminoAt}) > datetime(turno_fecha_hora_inicio)
      ${exclusion}
  `);

  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new ShiftBusinessError(
      'El trabajador ya tiene un turno que se superpone con el horario indicado.',
    );
  }
}

function assertShiftCanChange(
  shift: ShiftRow | null,
  now: Date,
  action: 'modificar' | 'eliminar',
): asserts shift is ShiftRow {
  if (!shift) {
    throw new ShiftBusinessError('El turno solicitado no existe.');
  }

  if (
    new Date(shift.inicioAt).getTime() <= now.getTime() ||
    Number(shift.asistenciaCount) > 0
  ) {
    throw new ShiftBusinessError(
      `El turno ya inicio o tiene asistencia registrada y no se puede ${action}.`,
    );
  }
}

function mapShiftRow(row: ShiftRow, now: Date): ShiftCalendarItem {
  const inicio = formatShiftTimestamp(row.inicioAt);
  const termino = formatShiftTimestamp(row.terminoAt);

  return {
    turnoId: row.turnoId,
    trabajadorId: Number(row.trabajadorId),
    trabajadorNombre: row.trabajadorNombre,
    fecha: inicio.fecha,
    fechaIso: inicio.fechaIso,
    horaInicio: inicio.hora,
    horaTermino: termino.hora,
    inicioAt: row.inicioAt,
    terminoAt: row.terminoAt,
    puedeModificar:
      new Date(row.inicioAt).getTime() > now.getTime() &&
      Number(row.asistenciaCount) === 0,
  };
}

function requireRange(values: {
  fecha: string;
  horaInicio: string;
  horaTermino: string;
}): NonNullable<ReturnType<typeof parseShiftRange>> {
  const range = parseShiftRange(values);

  if (!range) {
    throw new ShiftValidationError('Revise los campos marcados.');
  }

  return range;
}

function assertValid(errors: ShiftFieldErrors): void {
  if (hasShiftFieldErrors(errors)) {
    throw new ShiftValidationError(
      'Revise los campos marcados antes de continuar.',
      errors,
    );
  }
}
