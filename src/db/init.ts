/**
 * Inicialización de la base de datos en tiempo de ejecución.
 *
 * Aplica, de forma idempotente y en orden:
 *   1. Las migraciones de esquema (drizzle/migrations) con el migrador de libSQL.
 *   2. Los triggers de integridad (src/db/triggers.sql) vía executeMultiple.
 *
 * Se invoca desde el proceso main de Electron en `app.whenReady()`, ANTES de
 * abrir cualquier ventana que dependa de la BD. Reemplaza a los scripts de dev
 * `db:migrate` y `db:triggers`, que usan `tsx` y NO existen en la app empaquetada.
 *
 * Este módulo NO importa Electron: el llamador (proceso main) resuelve las rutas
 * y se las pasa. Así sigue siendo testeable sin Electron presente.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { DB } from './client.js';

export interface DatabaseInitPaths {
  /** Carpeta con las migraciones drizzle (contiene meta/_journal.json). */
  migrationsFolder: string;
  /** Ruta al archivo triggers.sql con los triggers de integridad. */
  triggersPath: string;
}

/**
 * Resuelve las rutas de migraciones y triggers para desarrollo o empaquetado.
 *
 * @param options.isPackaged    `app.isPackaged` de Electron.
 * @param options.resourcesPath `process.resourcesPath` (raíz de extraResources).
 *
 * - Empaquetado: `drizzle/` y `triggers.sql` se copian a `process.resourcesPath`
 *   mediante `extraResources` (ver build.extraResources en package.json).
 * - Desarrollo / tests: rutas del repositorio (`process.cwd()`).
 */
export function resolveDatabaseInitPaths(options?: {
  isPackaged?: boolean;
  resourcesPath?: string;
}): DatabaseInitPaths {
  if (options?.isPackaged && options.resourcesPath) {
    return {
      migrationsFolder: join(options.resourcesPath, 'drizzle', 'migrations'),
      triggersPath: join(options.resourcesPath, 'triggers.sql'),
    };
  }

  return {
    migrationsFolder: join(process.cwd(), 'drizzle', 'migrations'),
    triggersPath: join(process.cwd(), 'src', 'db', 'triggers.sql'),
  };
}

/**
 * Aplica los triggers de integridad. Idempotente: triggers.sql usa
 * `CREATE TRIGGER IF NOT EXISTS`. `executeMultiple` deja que el parser de
 * SQLite separe sentencias, manejando correctamente los cuerpos BEGIN...END.
 */
export async function applyTriggers(
  client: Client,
  triggersPath: string,
): Promise<void> {
  const script = await readFile(triggersPath, 'utf-8');
  await client.executeMultiple(script);
}

/**
 * Ejecuta migraciones y triggers contra la BD ya conectada.
 *
 * @param db     instancia drizzle (de `./client`).
 * @param client cliente libSQL subyacente (de `./client`).
 * @param paths  rutas resueltas; por defecto las de desarrollo/tests.
 */
export async function initializeDatabase(
  db: DB,
  client: Client,
  paths: DatabaseInitPaths = resolveDatabaseInitPaths(),
): Promise<void> {
  // 1. Migraciones de esquema. El migrador registra lo aplicado en
  //    __drizzle_migrations, por lo que repetir la llamada es seguro.
  await migrate(db, { migrationsFolder: paths.migrationsFolder });

  // 2. Triggers de integridad.
  await applyTriggers(client, paths.triggersPath);
}
