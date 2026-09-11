import { sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  DEFAULT_PREVISIONAL_RATES,
  PREVISIONAL_TIPOS,
  hasPrevisionalFieldErrors,
  normalizePrevisionalUpdatePayload,
  validatePrevisionalRates,
  type PrevisionalFieldErrors,
  type PrevisionalRates,
  type TasaLegalTipo,
} from "../../shared/previsional";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { db, schema } from "../../db/client";
import { authorizeUser } from "./auth-context";
import { registerAuditLog, type DbExecutor } from "./sale-service";

const metadata = controllers[27];

export type PrevisionalActor = {
  role: "dueno";
  usuarioId: string;
};

export type VigentTasa = {
  tipo: TasaLegalTipo;
  tasaLegalId: number;
  valor: number;
};

export class PrevisionalValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: PrevisionalFieldErrors = {},
  ) {
    super(message);
  }
}

export class PrevisionalAccessError extends Error {}

export const configPrevisionalController: RegisteredController = {
  metadata,
  handle: async (payload, context) => {
    try {
      if (context.channel === "configuracion:previsional-obtener") {
        const actor = await requireOwner(getUsuarioId(payload));
        return controllerSuccess(
          await getPrevisionalRates(db as unknown as DbExecutor, actor),
        );
      }

      if (context.channel === "configuracion:previsional-actualizar") {
        const input = normalizePrevisionalUpdatePayload(payload);
        const errors = validatePrevisionalRates(input);

        if (hasPrevisionalFieldErrors(errors)) {
          throw new PrevisionalValidationError(
            "Revise los porcentajes marcados antes de continuar.",
            errors,
          );
        }

        const actor = await requireOwner(input.usuarioId);
        return controllerSuccess(
          await updatePrevisionalRates(
            db as unknown as DbExecutor,
            input,
            actor,
          ),
        );
      }

      return controllerError(
        "INVALID_CHANNEL",
        `Canal IPC no registrado: ${context.channel}`,
        metadata.id,
      );
    } catch (error) {
      if (error instanceof PrevisionalValidationError) {
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

      if (error instanceof PrevisionalAccessError) {
        return controllerError("FORBIDDEN", error.message, metadata.id);
      }

      console.error(error);
      return controllerError(
        "TECHNICAL_ERROR",
        "No fue posible procesar la configuracion previsional. Intente nuevamente.",
        metadata.id,
      );
    }
  },
};

export async function getPrevisionalRates(
  database: DbExecutor,
  actor: PrevisionalActor,
): Promise<PrevisionalRates> {
  assertOwnerActor(actor);
  return toRatesRecord(await ensureVigentTasas(database));
}

export async function updatePrevisionalRates(
  database: DbExecutor,
  input: PrevisionalRates,
  actor: PrevisionalActor,
): Promise<PrevisionalRates> {
  return database.transaction(async (tx) => {
    assertOwnerActor(actor);
    const current = await ensureVigentTasas(tx);
    const now = new Date().toISOString();
    const changed: TasaLegalTipo[] = [];

    for (const tipo of PREVISIONAL_TIPOS) {
      const vigente = current.find((tasa) => tasa.tipo === tipo);
      const nuevoValor = input[tipo];

      if (vigente && vigente.valor === nuevoValor) {
        continue;
      }

      if (vigente) {
        await tx.run(sql`
          UPDATE tasa_legal
          SET tasa_legal_fecha_vigencia_hasta = ${now}
          WHERE tasa_legal_id = ${vigente.tasaLegalId}
        `);
      }

      await tx.run(sql`
        INSERT INTO tasa_legal (
          tasa_legal_tipo,
          tasa_legal_valor,
          tasa_legal_fecha_vigencia_desde
        )
        VALUES (${tipo}, ${nuevoValor}, ${now})
      `);

      changed.push(tipo);
    }

    if (changed.length > 0) {
      await registerAuditLog(tx, {
        usuarioId: actor.usuarioId,
        tipoAccion: "configurar_previsional",
        modulo: "personal",
        descripcion: `Porcentajes previsionales actualizados: ${changed
          .map((tipo) => `${tipo} ${input[tipo]}%`)
          .join(", ")}.`,
      });
    }

    return toRatesRecord(await ensureVigentTasas(tx));
  });
}

/**
 * Devuelve la tasa vigente por tipo (afp/salud/cesantia), inicializando en la
 * base de datos los valores por defecto (RF35) la primera vez que se
 * consultan. C44 depende de esta funcion para dejar en RemuneracionTasa una
 * referencia real a TasaLegal.
 */
export async function ensureVigentTasas(
  database: DbExecutor,
): Promise<VigentTasa[]> {
  const result: VigentTasa[] = [];

  for (const tipo of PREVISIONAL_TIPOS) {
    const existing = await database.all<{
      tasaLegalId: number;
      valor: number;
    }>(sql`
      SELECT tasa_legal_id AS tasaLegalId, tasa_legal_valor AS valor
      FROM tasa_legal
      WHERE tasa_legal_tipo = ${tipo}
        AND tasa_legal_fecha_vigencia_hasta IS NULL
      ORDER BY tasa_legal_fecha_vigencia_desde DESC
      LIMIT 1
    `);

    if (existing[0]) {
      result.push({
        tipo,
        tasaLegalId: existing[0].tasaLegalId,
        valor: existing[0].valor,
      });
      continue;
    }

    const vigenciaDesde = new Date().toISOString();
    const valor = DEFAULT_PREVISIONAL_RATES[tipo];

    await database.run(sql`
      INSERT INTO tasa_legal (
        tasa_legal_tipo,
        tasa_legal_valor,
        tasa_legal_fecha_vigencia_desde
      )
      VALUES (${tipo}, ${valor}, ${vigenciaDesde})
    `);

    const created = await database.all<{ tasaLegalId: number }>(sql`
      SELECT tasa_legal_id AS tasaLegalId
      FROM tasa_legal
      WHERE tasa_legal_tipo = ${tipo}
        AND tasa_legal_fecha_vigencia_desde = ${vigenciaDesde}
      ORDER BY tasa_legal_id DESC
      LIMIT 1
    `);

    result.push({ tipo, tasaLegalId: created[0]!.tasaLegalId, valor });
  }

  return result;
}

function toRatesRecord(rates: VigentTasa[]): PrevisionalRates {
  const record = {} as PrevisionalRates;

  for (const rate of rates) {
    record[rate.tipo] = rate.valor;
  }

  return record;
}

async function requireOwner(
  usuarioId: string | undefined,
): Promise<PrevisionalActor> {
  try {
    const user = await authorizeUser(db, schema, usuarioId, ["dueno"]);
    return { role: "dueno", usuarioId: user.usuarioId };
  } catch {
    throw new PrevisionalAccessError(
      "No tiene permiso para configurar los descuentos previsionales.",
    );
  }
}

function assertOwnerActor(actor: PrevisionalActor): void {
  if (!actor.usuarioId?.trim() || actor.role !== "dueno") {
    throw new PrevisionalAccessError(
      "No tiene permiso para configurar los descuentos previsionales.",
    );
  }
}

function getUsuarioId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "usuarioId" in payload &&
    typeof (payload as Record<string, unknown>).usuarioId === "string"
  ) {
    return (payload as Record<string, unknown>).usuarioId as string;
  }

  return undefined;
}
