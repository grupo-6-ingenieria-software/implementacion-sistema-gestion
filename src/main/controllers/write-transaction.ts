import type { DbExecutor } from "./sale-service";

const MAX_WRITE_ATTEMPTS = 3;

/**
 * libSQL inicia `transaction()` en modo write (BEGIN IMMEDIATE). Una conexión
 * competidora puede recibir SQLITE_BUSY; al reintentar, vuelve a ejecutar todas
 * las lecturas de dominio dentro de una transacción nueva y ve el estado ganador.
 */
export async function runSerializedWriteTransaction<T>(
  database: DbExecutor,
  callback: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await database.transaction(callback);
    } catch (error) {
      if (!isSqliteBusy(error) || attempt === MAX_WRITE_ATTEMPTS) throw error;
      await waitForCompetingWriter(attempt * 20);
    }
  }

  throw new Error("No fue posible iniciar la transacción de escritura.");
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    extendedCode?: unknown;
    cause?: { code?: unknown };
  };
  return (
    candidate.code === "SQLITE_BUSY" ||
    candidate.extendedCode === "SQLITE_BUSY" ||
    candidate.cause?.code === "SQLITE_BUSY"
  );
}

function waitForCompetingWriter(delay: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}
