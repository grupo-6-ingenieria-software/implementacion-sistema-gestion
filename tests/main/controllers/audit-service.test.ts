import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../src/db/schema';
import { queryAuditLog } from '../../../src/main/controllers/audit-service';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

beforeEach(async () => {
  await clearAuditFixture(testDb!.db);
  await seedAuditFixture(testDb!.db);
});

afterAll(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('queryAuditLog', () => {
  it('returns recent audit entries in descending order and registers the query', async () => {
    const response = await queryAuditLog(testDb!.db, schema, {
      page: 1,
      pageSize: 2,
      usuarioId: '12345678-9',
    });

    expect(response.ok).toBe(true);

    if (!response.ok) {
      return;
    }

    expect(response.data.total).toBe(3);
    expect(response.data.entries.map((entry) => entry.tipoAccion)).toEqual([
      'cerrar_caja',
      'edicion',
    ]);
    expect(response.data.entries.map((entry) => entry.usuarioNombre)).toEqual([
      'Maria Huascar',
      'Camila Rojas',
    ]);

    const queryRows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM log_auditoria
      WHERE log_tipo_accion = 'consulta'
    `);

    expect(Number(queryRows[0].count)).toBe(1);
  });

  it('filters by user, action type and date range', async () => {
    const response = await queryAuditLog(testDb!.db, schema, {
      fechaDesde: '2026-06-11',
      fechaHasta: '2026-06-11',
      page: 1,
      pageSize: 25,
      tipoAccion: 'edicion',
      usuarioFiltroId: '23456789-0',
      usuarioId: '12345678-9',
    });

    expect(response.ok).toBe(true);

    if (!response.ok) {
      return;
    }

    expect(response.data.total).toBe(1);
    expect(response.data.entries[0]).toMatchObject({
      modulo: 'inventario',
      tipoAccion: 'edicion',
      usuarioId: '23456789-0',
    });
  });

  it('rejects invalid date filters', async () => {
    const response = await queryAuditLog(testDb!.db, schema, {
      fechaDesde: '2026-06-12',
      fechaHasta: '2026-06-11',
      usuarioId: '12345678-9',
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'audit',
      },
    });
  });

  it('denies workers and registers the denied attempt', async () => {
    const response = await queryAuditLog(testDb!.db, schema, {
      usuarioId: '23456789-0',
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        controllerId: 'audit',
      },
    });

    const deniedRows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM log_auditoria
      WHERE log_tipo_accion = 'acceso_denegado'
        AND usuario_version_id = '00000000-0000-4000-8000-000000000202'
    `);

    expect(Number(deniedRows[0].count)).toBe(1);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-audit-'));
  const dbPath = join(dir, 'test.db').replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute('PRAGMA foreign_keys = ON');
  const migration = await readFile(
    join(process.cwd(), 'drizzle/migrations/0000_brave_proteus.sql'),
    'utf8',
  );

  for (const statement of migration.split('--> statement-breakpoint')) {
    const sqlStatement = statement.trim();

    if (sqlStatement.length > 0) {
      await client.execute(sqlStatement);
    }
  }

  return { client, db, dir };
}

async function clearAuditFixture(db: TestDatabase['db']): Promise<void> {
  await db.run(sql`DELETE FROM log_auditoria`);
  await db.run(sql`DELETE FROM usuario_version`);
  await db.run(sql`DELETE FROM usuario`);
  await db.run(sql`DELETE FROM trabajador`);
}

async function seedAuditFixture(db: TestDatabase['db']): Promise<void> {
  await db.run(sql`
    INSERT INTO trabajador (
      trabajador_id,
      trabajador_rut,
      trabajador_nombre,
      trabajador_apellido,
      trabajador_telefono,
      trabajador_fecha_ingreso,
      trabajador_estado
    )
    VALUES
      (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo'),
      (2, '23456789-0', 'Camila', 'Rojas', '912345678', '2025-06-15', 'activo')
  `);

  await db.run(sql`
    INSERT INTO usuario (
      usuario_id,
      usuario_rol,
      usuario_fecha_creacion,
      trabajador_id
    )
    VALUES
      ('12345678-9', 'due\u00f1o', '2026-01-01T00:00:00.000Z', 1),
      ('23456789-0', 'cajero', '2026-01-01T00:00:00.000Z', 2)
  `);

  await db.run(sql`
    INSERT INTO usuario_version (
      usuario_version_id,
      usuario_version_nombre,
      usuario_version_rol,
      usuario_version_fecha_hora_vigencia_desde,
      usuario_id
    )
    VALUES
      (
        '00000000-0000-4000-8000-000000000201',
        'Maria Huascar',
        'due\u00f1o',
        '2026-01-01T00:00:00.000Z',
        '12345678-9'
      ),
      (
        '00000000-0000-4000-8000-000000000202',
        'Camila Rojas',
        'cajero',
        '2026-01-01T00:00:00.000Z',
        '23456789-0'
      )
  `);

  await insertAuditRow(db, {
    descripcion: 'Producto registrado',
    fechaHora: '2026-06-10T09:00:00.000Z',
    modulo: 'inventario',
    tipoAccion: 'registro',
    usuarioVersionId: '00000000-0000-4000-8000-000000000201',
  });
  await insertAuditRow(db, {
    descripcion: 'Producto actualizado',
    fechaHora: '2026-06-11T09:00:00.000Z',
    modulo: 'inventario',
    tipoAccion: 'edicion',
    usuarioVersionId: '00000000-0000-4000-8000-000000000202',
  });
  await insertAuditRow(db, {
    descripcion: 'Caja cerrada',
    fechaHora: '2026-06-12T09:00:00.000Z',
    modulo: 'caja',
    tipoAccion: 'cerrar_caja',
    usuarioVersionId: '00000000-0000-4000-8000-000000000201',
  });
}

async function insertAuditRow(
  db: TestDatabase['db'],
  input: {
    descripcion: string;
    fechaHora: string;
    modulo: string;
    tipoAccion: string;
    usuarioVersionId: string;
  },
): Promise<void> {
  await db.run(sql`
    INSERT INTO log_auditoria (
      log_auditoria_id,
      log_fecha_hora,
      log_tipo_accion,
      log_modulo,
      log_descripcion,
      usuario_version_id
    )
    VALUES (
      ${randomUUID()},
      ${input.fechaHora},
      ${input.tipoAccion},
      ${input.modulo},
      ${input.descripcion},
      ${input.usuarioVersionId}
    )
  `);
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
