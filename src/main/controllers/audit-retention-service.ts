import { sql, type SQL } from "drizzle-orm";
import type { DB } from "../../db/client";

export const AUDIT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Usa el reloj de la BD, igual que el trigger de DELETE, para que todas las
// instancias calculen el mismo límite. SQLite 3.45 no admite el modificador
// 'floor': el 29 de febrero se ajusta explícitamente al 28 del año anterior.
export function auditRetentionCutoffExpression(clock: SQL = sql`'now'`): SQL {
  return sql`CASE WHEN strftime('%m-%d', ${clock}) = '02-29'
    THEN julianday(${clock}, '-1 year', '-1 day')
    ELSE julianday(${clock}, '-1 year')
  END`;
}

export async function purgeExpiredAuditLogs(
  database: Pick<DB, "run">,
): Promise<number> {
  const result = await database.run(sql`
    DELETE FROM log_auditoria
    WHERE julianday(log_fecha_hora) <= ${auditRetentionCutoffExpression()}
  `);
  return result.rowsAffected;
}

export function startAuditRetentionMaintenance(deps: {
  purge: () => Promise<number>;
  reportError: (error: unknown) => void;
}): () => void {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await deps.purge();
    } catch (error) {
      deps.reportError(error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => { void run(); }, AUDIT_RETENTION_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
