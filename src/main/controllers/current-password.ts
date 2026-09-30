import { desc, eq, sql } from "drizzle-orm";
import type { db } from "../../db/client";

// rowid desempata operaciones realizadas en el mismo milisegundo. El UUID no
// expresa el orden de creación y podría volver a seleccionar la clave anterior.
export async function loadCurrentPassword(
  database: Pick<typeof db, "select">,
  schema: typeof import("../../db/schema"),
  usuarioId: string,
) {
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
}
