import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import * as schema from "../../db/schema";
import { registerAuditLog } from "./auth-context";
import type { ReportFileOperation } from "./report-export-file";

export class ReportCommitUncertainError extends Error {
  constructor(options?: ErrorOptions) { super("ReportCommitUncertain", options); }
}
export type ReportAuditStorage = {
  finalize: (operation: ReportFileOperation, publish: () => Promise<void>) => Promise<void>;
  confirmed: (operation: ReportFileOperation) => Promise<boolean>;
};

function knownSqlRejection(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return false;
  return /^SQLITE_(BUSY|LOCKED|CONSTRAINT|ABORT|ERROR)(_|$)/.test(error.code);
}

export function createReportAuditStorage(database: Pick<DB, "transaction">): ReportAuditStorage {
  return {
    finalize: async (operation, publish) => {
      let readyToCommit = false;
      try {
        await database.transaction(async (tx) => {
          await registerAuditLog(tx, schema, {
            usuarioId: operation.usuarioId, modulo: "reportes", tipoAccion: "exportacion",
            descripcion: operation.auditDescripcion,
          }, { logAuditoriaId: operation.operacionId, fechaHora: operation.auditFechaHora });
          await publish();
          readyToCommit = true;
        });
      } catch (error) {
        // A transport failure after the callback may mean COMMIT succeeded remotely.
        if (readyToCommit && !knownSqlRejection(error))
          throw new ReportCommitUncertainError({ cause: error });
        throw error;
      }
    },
    confirmed: async (operation) => {
      // libSQL's write transaction acquires the writer lock before reading. This
      // settles the previous writer; a detached/non-authoritative SELECT is insufficient.
      return database.transaction(async (tx) => {
        const [row] = await tx.select({
          descripcion: schema.logAuditoria.logDescripcion,
          modulo: schema.logAuditoria.logModulo,
          accion: schema.logAuditoria.logTipoAccion,
          fecha: schema.logAuditoria.logFechaHora,
          usuarioId: schema.usuarioVersion.usuarioId,
        }).from(schema.logAuditoria)
          .innerJoin(schema.usuarioVersion, eq(schema.usuarioVersion.usuarioVersionId, schema.logAuditoria.usuarioVersionId))
          .where(eq(schema.logAuditoria.logAuditoriaId, operation.operacionId)).limit(1);
        if (!row) return false;
        if (row.modulo !== "reportes" || row.accion !== "exportacion" || row.usuarioId !== operation.usuarioId ||
          row.descripcion !== operation.auditDescripcion || row.fecha !== operation.auditFechaHora)
          throw new Error("ReportAuditEvidenceMismatch");
        return true;
      });
    },
  };
}
