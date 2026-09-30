import { desc, eq, sql } from "drizzle-orm";
import type { db } from "../../db/client";

// rowid desempata operaciones realizadas en el mismo milisegundo. El UUID no
// expresa el orden de creación y podría volver a seleccionar la clave anterior.
export async function loadCurrentPassword(
  database: Pick<typeof db, "select">,
  schema: typeof import("../../db/schema"),
  usuarioId: string,
) {
  try {
    const [current] = await database
      .select({
        contrasenaId: schema.contrasena.contrasenaId,
        contrasenaHash: schema.contrasena.contrasenaHash,
        esContrasenaTemporal: schema.contrasena.esContrasenaTemporal,
        expiracion: schema.contrasenaTemporal.contrasenaTemporalFechaHoraExpiracion,
      })
      .from(schema.contrasena)
      .leftJoin(
        schema.contrasenaTemporal,
        eq(schema.contrasenaTemporal.contrasenaId, schema.contrasena.contrasenaId),
      )
      .where(eq(schema.contrasena.usuarioId, usuarioId))
      .orderBy(
        desc(schema.contrasena.contrasenaFechaHoraCreacion),
        sql`contrasena.rowid DESC`,
      )
      .limit(1);
    return current;
  } catch (error) {
    if (!isMissingLegacyPasswordFlag(error)) throw error;
  }

  // Compatibilidad de lectura con bases anteriores: allí el subtipo temporal
  // es la única fuente de este dato. No cambia el esquema ni las credenciales.
  const [legacy] = await database
    .select({
      contrasenaId: schema.contrasena.contrasenaId,
      contrasenaHash: schema.contrasena.contrasenaHash,
      esContrasenaTemporal: sql<number>`CASE WHEN ${schema.contrasenaTemporal.contrasenaId} IS NULL THEN 0 ELSE 1 END`,
      expiracion: schema.contrasenaTemporal.contrasenaTemporalFechaHoraExpiracion,
    })
    .from(schema.contrasena)
    .leftJoin(
      schema.contrasenaTemporal,
      eq(schema.contrasenaTemporal.contrasenaId, schema.contrasena.contrasenaId),
    )
    .where(eq(schema.contrasena.usuarioId, usuarioId))
    .orderBy(
      desc(schema.contrasena.contrasenaFechaHoraCreacion),
      sql`contrasena.rowid DESC`,
    )
    .limit(1);
  return legacy ? { ...legacy, esContrasenaTemporal: legacy.esContrasenaTemporal === 1 } : undefined;
}

function isMissingLegacyPasswordFlag(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth += 1) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" &&
        /no such column:\s*(?:["`]?contrasena["`]?\.)?["`]?es_contrasena_temporal["`]?/i.test(message)) {
      return true;
    }
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}
