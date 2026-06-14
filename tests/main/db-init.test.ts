import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { initializeDatabase, resolveDatabaseInitPaths } from '../../src/db/init';

type TestDatabase = Awaited<ReturnType<typeof createEmptyDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createEmptyDatabase();
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('initializeDatabase', () => {
  it('crea el esquema en una BD vacía (las migraciones se aplican)', async () => {
    // Antes de inicializar, la BD está vacía: la tabla producto no existe.
    const before = await tableExists(testDb!.client, 'producto');
    expect(before).toBe(false);

    await initializeDatabase(testDb!.db, testDb!.client);

    // Tras inicializar, una tabla conocida del esquema existe.
    expect(await tableExists(testDb!.client, 'producto')).toBe(true);
    expect(await tableExists(testDb!.client, 'venta')).toBe(true);
    expect(await tableExists(testDb!.client, 'log_errores_tecnicos')).toBe(true);
  });

  it('instala los triggers de integridad y estos disparan', async () => {
    await initializeDatabase(testDb!.db, testDb!.client);

    // Un trigger conocido quedó registrado.
    const triggers = await testDb!.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'trigger'",
    );
    const triggerNames = triggers.rows.map((row) => String(row.name));
    expect(triggerNames).toContain('trg_log_errores_no_update');
    expect(triggerNames).toContain('trg_log_errores_no_delete');

    // log_errores_tecnicos es append-only: insertar es válido (usuario_id es
    // nullable), pero UPDATE y DELETE deben abortar vía RAISE(ABORT, ...).
    const id = randomUUID();
    await testDb!.client.execute({
      sql: `INSERT INTO log_errores_tecnicos
              (log_errortecnicos_id, log_errores_tipo_error,
               log_errores_modulo, log_errores_descripcion_tecnica, usuario_id)
            VALUES (?, 'error', 'test', 'descripcion', NULL)`,
      args: [id],
    });

    await expect(
      testDb!.client.execute({
        sql: `UPDATE log_errores_tecnicos
                SET log_errores_modulo = 'otro' WHERE log_errortecnicos_id = ?`,
        args: [id],
      }),
    ).rejects.toThrow(/inmutable|RNF10|UPDATE no permitido/i);

    await expect(
      testDb!.client.execute({
        sql: `DELETE FROM log_errores_tecnicos WHERE log_errortecnicos_id = ?`,
        args: [id],
      }),
    ).rejects.toThrow(/inmutable|RNF10|DELETE no permitido/i);
  });

  it('es idempotente: ejecutarla dos veces no falla', async () => {
    await initializeDatabase(testDb!.db, testDb!.client);
    await expect(
      initializeDatabase(testDb!.db, testDb!.client),
    ).resolves.toBeUndefined();

    expect(await tableExists(testDb!.client, 'producto')).toBe(true);
  });
});

describe('resolveDatabaseInitPaths', () => {
  it('usa rutas del repo en desarrollo', () => {
    const paths = resolveDatabaseInitPaths({ isPackaged: false });
    expect(paths.migrationsFolder).toContain(join('drizzle', 'migrations'));
    expect(paths.triggersPath).toContain(join('src', 'db', 'triggers.sql'));
  });

  it('usa process.resourcesPath cuando está empaquetada', () => {
    const paths = resolveDatabaseInitPaths({
      isPackaged: true,
      resourcesPath: '/opt/app/resources',
    });
    expect(paths.migrationsFolder).toBe(
      join('/opt/app/resources', 'drizzle', 'migrations'),
    );
    expect(paths.triggersPath).toBe(join('/opt/app/resources', 'triggers.sql'));
  });
});

async function createEmptyDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-init-'));
  const dbPath = join(dir, 'test.db').replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute('PRAGMA foreign_keys = ON');

  return { client, db, dir };
}

async function tableExists(
  client: ReturnType<typeof createClient>,
  table: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return result.rows.length > 0;
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
