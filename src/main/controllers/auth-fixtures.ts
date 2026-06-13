/**
 * Utilidades de prueba compartidas para el módulo de autenticación.
 * Levanta una base libSQL temporal aplicando la migración real y permite
 * sembrar usuarios con contraseñas de forma controlada.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../../db/schema';

export type AuthTestDatabase = Awaited<
  ReturnType<typeof createAuthTestDatabase>
>;

export async function createAuthTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-auth-'));
  const dbPath = join(dir, 'test.db').replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute('PRAGMA foreign_keys = ON');

  // Aplica TODAS las migraciones en orden (incl. 0001 que normaliza los roles
  // a 'dueno'/'trabajador'), igual que las demás pruebas de controladores.
  const migrationsDir = join(process.cwd(), 'drizzle/migrations');
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const migration = await readFile(join(migrationsDir, file), 'utf8');

    for (const statement of migration.split('--> statement-breakpoint')) {
      const sqlStatement = statement.trim();

      if (sqlStatement.length > 0) {
        await client.execute(sqlStatement);
      }
    }
  }

  return { client, db, dir };
}

export type SeedUserOptions = {
  usuarioId: string;
  trabajadorId: number;
  rut: string;
  /** Rol almacenado en la BD (sin acento, esquema 2 roles: dueno | trabajador). */
  rolBd?: 'dueno' | 'trabajador';
  estado?: 'activo' | 'inactivo';
  nombre?: string;
  apellido?: string;
  conContrasena?: boolean;
  hash?: string;
  esTemporal?: boolean;
  /** Expiración de la contraseña temporal en ISO; null = sin fila de expiración. */
  temporalExpiracion?: string | null;
};

export async function seedUser(
  db: AuthTestDatabase['db'],
  options: SeedUserOptions,
): Promise<void> {
  const {
    usuarioId,
    trabajadorId,
    rut,
    rolBd = 'dueno',
    estado = 'activo',
    nombre = 'María',
    apellido = 'Huáscar',
    conContrasena = true,
    hash = 'hash-definitiva',
    esTemporal = false,
    temporalExpiracion = null,
  } = options;

  await db.run(sql`
    INSERT INTO trabajador (
      trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
      trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado
    )
    VALUES (
      ${trabajadorId}, ${rut}, ${nombre}, ${apellido},
      '987654321', '2024-01-01', ${estado}
    )
  `);

  await db.run(sql`
    INSERT INTO usuario (
      usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id
    )
    VALUES (
      ${usuarioId}, ${rolBd}, '2026-01-01T00:00:00.000Z', ${trabajadorId}
    )
  `);

  if (!conContrasena) {
    return;
  }

  const [created] = await db
    .insert(schema.contrasena)
    .values({
      contrasenaHash: hash,
      contrasenaFechaHoraCreacion: '2026-01-01T00:00:00.000Z',
      esContrasenaTemporal: esTemporal,
      esContrasenaDefinitiva: !esTemporal,
      usuarioId,
      generadaPorUsuarioId: usuarioId,
    })
    .returning({ contrasenaId: schema.contrasena.contrasenaId });

  if (esTemporal && temporalExpiracion) {
    await db.insert(schema.contrasenaTemporal).values({
      contrasenaId: created.contrasenaId,
      contrasenaTemporalFechaHoraExpiracion: temporalExpiracion,
    });
  }
}

export async function insertLoginAttempt(
  db: AuthTestDatabase['db'],
  attempt: { usuario: string; exitoso: boolean; fechaHora: string; usuarioId?: string | null },
): Promise<void> {
  await db.insert(schema.intentoLogin).values({
    intentoNombreUsuarioIngresado: attempt.usuario,
    intentoFechaHora: attempt.fechaHora,
    intentoExitoso: attempt.exitoso,
    usuarioId: attempt.usuarioId ?? null,
  });
}

export async function removeAuthTempDir(dir: string): Promise<void> {
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
