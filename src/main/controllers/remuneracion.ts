import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import type { AttendanceWorkerOption } from "../../shared/attendance";
import {
  calculateRemuneracion,
  hasRemuneracionFieldErrors,
  normalizeRemuneracionCreatePayload,
  normalizeRemuneracionPeriodoPayload,
  validateRemuneracionCreatePayload,
  validateRemuneracionPeriodo,
  type RemuneracionCreatePayload,
  type RemuneracionFieldErrors,
  type RemuneracionMutationResponse,
  type RemuneracionPeriodoPayload,
} from "../../shared/remuneraciones";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { db, schema } from "../../db/client";
import { authorizeUser } from "./auth-context";
import { registerAuditLog, type DbExecutor } from "./sale-service";
import { ensureVigentTasas } from "./configuracion-previsional";

const metadata = controllers.find(
  (controller) => controller.id === "remuneracion",
)!;

export type RemuneracionActor = {
  role: "dueno";
  usuarioId: string;
};

export class RemuneracionValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: RemuneracionFieldErrors = {},
  ) {
    super(message);
  }
}

export class RemuneracionAccessError extends Error {}
export class RemuneracionBusinessError extends Error {}

export const remuneracionController: RegisteredController = {
  metadata,
  handle: async (payload, context) => {
    try {
      if (context.channel === "remuneracion:registrar") {
        const input = normalizeRemuneracionCreatePayload(payload);
        assertValid(validateRemuneracionCreatePayload(input));
        const actor = await requireOwner(input.usuarioId);
        return controllerSuccess(
          await registerRemuneracion(
            db as unknown as DbExecutor,
            input,
            actor,
          ),
        );
      }

      if (context.channel === "remuneracion:trabajadores-elegibles") {
        const input = normalizeRemuneracionPeriodoPayload(payload);
        assertValid(validateRemuneracionPeriodo(input));
        await requireOwner(input.usuarioId);
        return controllerSuccess(
          await listEligibleWorkers(db as unknown as DbExecutor, input),
        );
      }

      return controllerError(
        "INVALID_CHANNEL",
        `Canal IPC no registrado: ${context.channel}`,
        metadata.id,
      );
    } catch (error) {
      if (error instanceof RemuneracionValidationError) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: metadata.id,
            fieldErrors: error.fieldErrors,
            message: error.message,
          },
        };
      }

      if (error instanceof RemuneracionAccessError) {
        return controllerError("FORBIDDEN", error.message, metadata.id);
      }

      if (error instanceof RemuneracionBusinessError) {
        return controllerError("BUSINESS_RULE", error.message, metadata.id);
      }

      console.error(error);
      return controllerError(
        "TECHNICAL_ERROR",
        "No fue posible registrar la remuneracion. Intente nuevamente.",
        metadata.id,
      );
    }
  },
};

export async function registerRemuneracion(
  database: DbExecutor,
  payload: RemuneracionCreatePayload,
  actor: RemuneracionActor,
): Promise<RemuneracionMutationResponse> {
  return database.transaction(async (tx) => {
    assertOwnerActor(actor);
    const worker = await findEligibleWorker(tx, payload);

    if (!worker) {
      throw new RemuneracionValidationError("Revise los campos marcados.", {
        trabajadorId:
          "El trabajador no esta activo ni registra actividad en el periodo indicado.",
      });
    }

    await assertPeriodoUnico(tx, payload);

    // RF34 depende de RF35 (CU35): las tasas vigentes se resuelven al
    // registrar, nunca segun el mes remunerado.
    const tasas = await ensureVigentTasas(tx);
    const { descuentos, montoLiquido } = calculateRemuneracion(
      payload.montoBruto,
      tasas.map((tasa) => ({ tipo: tasa.tipo, porcentaje: tasa.valor })),
    );

    if (montoLiquido < 0) {
      throw new RemuneracionValidationError(
        "El monto liquido resultante no puede ser negativo.",
        { montoBruto: "El monto liquido resultante no puede ser negativo." },
      );
    }

    const remuneracionId = randomUUID();

    await tx.run(sql`
      INSERT INTO remuneracion (
        remuneracion_id,
        remuneracion_mes,
        remuneracion_anio,
        remuneracion_monto_bruto,
        remuneracion_observacion,
        trabajador_id,
        usuario_registrador_id
      )
      VALUES (
        ${remuneracionId},
        ${payload.mes},
        ${payload.anio},
        ${payload.montoBruto},
        ${payload.observacion ?? null},
        ${payload.trabajadorId},
        ${actor.usuarioId}
      )
    `);

    for (const tasa of tasas) {
      await tx.run(sql`
        INSERT INTO remuneracion_tasa (
          remuneracion_tasa_id,
          remuneracion_id,
          tasa_legal_id
        )
        VALUES (${randomUUID()}, ${remuneracionId}, ${tasa.tasaLegalId})
      `);
    }

    await registerAuditLog(tx, {
      usuarioId: actor.usuarioId,
      tipoAccion: "registrar_remuneracion",
      modulo: "personal",
      descripcion: `Remuneracion registrada para ${worker.nombreCompleto} (${payload.mes}/${payload.anio}).`,
    });

    return { remuneracionId, descuentos, montoLiquido };
  });
}

/**
 * Trabajadores seleccionables para un periodo: activos, mas los inactivos
 * que igual registran turno o asistencia ese mes (precondicion de CU34). Un
 * trabajador inactivo sin actividad en el mes elegido no aparece aqui, pero
 * si aparecera para el mes en que si tuvo actividad.
 */
export async function listEligibleWorkers(
  database: Pick<DbExecutor, "all">,
  payload: RemuneracionPeriodoPayload,
): Promise<AttendanceWorkerOption[]> {
  const rows = await database.all<{
    trabajadorId: number;
    rut: string;
    nombreCompleto: string;
  }>(sql`
    SELECT
      t.trabajador_id AS trabajadorId,
      t.trabajador_rut AS rut,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombreCompleto
    FROM trabajador t
    WHERE t.trabajador_estado = 'activo'
       OR EXISTS (
         SELECT 1 FROM turno tu
         WHERE tu.trabajador_id = t.trabajador_id
           AND CAST(strftime('%Y', datetime(tu.turno_fecha_hora_inicio)) AS INTEGER) = ${payload.anio}
           AND CAST(strftime('%m', datetime(tu.turno_fecha_hora_inicio)) AS INTEGER) = ${payload.mes}
       )
       OR EXISTS (
         SELECT 1 FROM asistencia a
         WHERE a.trabajador_id = t.trabajador_id
           AND CAST(strftime('%Y', datetime(a.asistencia_fecha_hora_entrada)) AS INTEGER) = ${payload.anio}
           AND CAST(strftime('%m', datetime(a.asistencia_fecha_hora_entrada)) AS INTEGER) = ${payload.mes}
       )
    ORDER BY t.trabajador_nombre, t.trabajador_apellido
  `);

  return rows.map((row) => ({
    trabajadorId: row.trabajadorId,
    rut: row.rut,
    nombreCompleto: row.nombreCompleto,
  }));
}

async function findEligibleWorker(
  database: Pick<DbExecutor, "all">,
  payload: RemuneracionCreatePayload,
): Promise<{ nombreCompleto: string } | null> {
  const rows = await database.all<{
    nombreCompleto: string;
    estado: string;
    actividad: number;
  }>(sql`
    SELECT
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombreCompleto,
      t.trabajador_estado AS estado,
      (
        (SELECT COUNT(*) FROM turno tu
          WHERE tu.trabajador_id = t.trabajador_id
            AND CAST(strftime('%Y', datetime(tu.turno_fecha_hora_inicio)) AS INTEGER) = ${payload.anio}
            AND CAST(strftime('%m', datetime(tu.turno_fecha_hora_inicio)) AS INTEGER) = ${payload.mes})
        +
        (SELECT COUNT(*) FROM asistencia a
          WHERE a.trabajador_id = t.trabajador_id
            AND CAST(strftime('%Y', datetime(a.asistencia_fecha_hora_entrada)) AS INTEGER) = ${payload.anio}
            AND CAST(strftime('%m', datetime(a.asistencia_fecha_hora_entrada)) AS INTEGER) = ${payload.mes})
      ) AS actividad
    FROM trabajador t
    WHERE t.trabajador_id = ${payload.trabajadorId}
    LIMIT 1
  `);

  const row = rows[0];

  if (!row) {
    return null;
  }

  if (row.estado !== "activo" && Number(row.actividad) === 0) {
    return null;
  }

  return { nombreCompleto: row.nombreCompleto };
}

async function assertPeriodoUnico(
  database: Pick<DbExecutor, "all">,
  payload: RemuneracionCreatePayload,
): Promise<void> {
  const rows = await database.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count
    FROM remuneracion
    WHERE trabajador_id = ${payload.trabajadorId}
      AND remuneracion_anio = ${payload.anio}
      AND remuneracion_mes = ${payload.mes}
  `);

  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new RemuneracionBusinessError(
      "Ya existe una remuneracion registrada para este trabajador en el periodo indicado.",
    );
  }
}

async function requireOwner(
  usuarioId: string | undefined,
): Promise<RemuneracionActor> {
  try {
    const user = await authorizeUser(db, schema, usuarioId, ["dueno"]);
    return { role: "dueno", usuarioId: user.usuarioId };
  } catch {
    throw new RemuneracionAccessError(
      "No tiene permiso para registrar remuneraciones.",
    );
  }
}

function assertOwnerActor(actor: RemuneracionActor): void {
  if (!actor.usuarioId?.trim() || actor.role !== "dueno") {
    throw new RemuneracionAccessError(
      "No tiene permiso para registrar remuneraciones.",
    );
  }
}

function assertValid(errors: RemuneracionFieldErrors): void {
  if (hasRemuneracionFieldErrors(errors)) {
    throw new RemuneracionValidationError(
      "Revise los campos marcados antes de continuar.",
      errors,
    );
  }
}
