import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../src/db/schema';
import {
  AttendanceAccessError,
  AttendanceBusinessError,
  listActiveWorkers,
  registerAttendanceEntry,
  registerAttendanceEntryWithoutShift,
  registerAttendanceExit,
} from '../../../src/main/controllers/attendance-service';
import type { DbExecutor } from '../../../src/main/controllers/sale-service';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const now = new Date('2026-06-12T12:30:00.000Z');
let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedAttendanceFixture(testDb.db as unknown as DbExecutor);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('attendance service', () => {
  it('lists active workers for the owner', async () => {
    const workers = await listActiveWorkers(testDb!.db as unknown as DbExecutor, {
      usuarioId: '12345678-9',
    });

    expect(workers).toEqual([
      {
        trabajadorId: 2,
        rut: '23456789-0',
        nombreCompleto: 'Camila Rojas',
      },
      {
        trabajadorId: 1,
        rut: '12345678-9',
        nombreCompleto: 'Maria Huascar',
      },
      {
        trabajadorId: 4,
        rut: '45678901-2',
        nombreCompleto: 'Pedro Soto',
      },
    ]);
  });

  it('registers an entry with the worker shift', async () => {
    await seedShift(testDb!.db as unknown as DbExecutor, 2);

    const result = await registerAttendanceEntry(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: '12345678-9', trabajadorRut: '23.456.789-0' },
      now,
    );

    expect(result.status).toBe('registered');
    if (result.status !== 'registered') {
      throw new Error(result.message);
    }

    expect(result.trabajador.rut).toBe('23456789-0');
    expect(result.trabajador.turnoId).toBe(
      '00000000-0000-4000-8000-000000000201',
    );
    expect(result.entradaAt).toBe(now.toISOString());

    const rows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM log_auditoria
      WHERE log_tipo_accion = 'registrar_entrada_asistencia'
    `);
    expect(Number(rows[0].count)).toBe(1);
  });

  it('asks for confirmation when the worker has no shift', async () => {
    const result = await registerAttendanceEntry(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
      now,
    );

    expect(result).toMatchObject({
      status: 'requires_no_shift_confirmation',
      trabajador: {
        rut: '23456789-0',
        nombreCompleto: 'Camila Rojas',
      },
    });

    const rows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM asistencia`,
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it('registers an entry without shift after confirmation', async () => {
    const result = await registerAttendanceEntryWithoutShift(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
      now,
    );

    expect(result.status).toBe('registered');
    const rows = await testDb!.db.all<{ turnoId: string | null }>(sql`
      SELECT turno_id AS turnoId
      FROM asistencia
      WHERE trabajador_id = 2
    `);
    const auditRows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM log_auditoria
      WHERE log_tipo_accion = 'registrar_entrada_sin_turno'
    `);

    expect(rows[0].turnoId).toBeNull();
    expect(Number(auditRows[0].count)).toBe(1);
  });

  it('blocks duplicate entries', async () => {
    await seedAttendance(testDb!.db as unknown as DbExecutor, 2);

    await expect(
      registerAttendanceEntryWithoutShift(
        testDb!.db as unknown as DbExecutor,
        { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
        now,
      ),
    ).rejects.toBeInstanceOf(AttendanceBusinessError);
  });

  it('blocks inactive workers', async () => {
    await expect(
      registerAttendanceEntry(
        testDb!.db as unknown as DbExecutor,
        { usuarioId: '12345678-9', trabajadorRut: '34567890-1' },
        now,
      ),
    ).rejects.toBeInstanceOf(AttendanceBusinessError);
  });

  it('blocks workers from registering another worker attendance', async () => {
    await expect(
      registerAttendanceEntry(
        testDb!.db as unknown as DbExecutor,
        { usuarioId: '23456789-0', trabajadorRut: '45678901-2' },
        now,
      ),
    ).rejects.toBeInstanceOf(AttendanceAccessError);
  });

  it('blocks entries when the worker has an absence for the day', async () => {
    await seedAbsence(testDb!.db as unknown as DbExecutor, 2);

    await expect(
      registerAttendanceEntryWithoutShift(
        testDb!.db as unknown as DbExecutor,
        { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
        now,
      ),
    ).rejects.toBeInstanceOf(AttendanceBusinessError);
  });

  it('registers an exit and calculates worked hours', async () => {
    const asistenciaId = await seedAttendance(testDb!.db as unknown as DbExecutor, 2);

    const result = await registerAttendanceExit(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
      new Date('2026-06-12T20:00:00.000Z'),
    );

    expect(result).toMatchObject({
      status: 'registered',
      asistenciaId,
      entradaAt: '2026-06-12T12:00:00.000Z',
      salidaAt: '2026-06-12T20:00:00.000Z',
      horasTrabajadas: '08:00',
    });
  });

  it('blocks exits without a previous entry', async () => {
    await expect(
      registerAttendanceExit(
        testDb!.db as unknown as DbExecutor,
        { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
        now,
      ),
    ).rejects.toBeInstanceOf(AttendanceBusinessError);
  });

  it('blocks duplicate exits', async () => {
    await seedAttendance(testDb!.db as unknown as DbExecutor, 2, {
      salidaAt: '2026-06-12T20:00:00.000Z',
    });

    await expect(
      registerAttendanceExit(
        testDb!.db as unknown as DbExecutor,
        { usuarioId: '12345678-9', trabajadorRut: '23456789-0' },
        now,
      ),
    ).rejects.toBeInstanceOf(AttendanceBusinessError);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-attendance-'));
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

async function seedAttendanceFixture(db: DbExecutor): Promise<void> {
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
      (2, '23456789-0', 'Camila', 'Rojas', '912345678', '2025-06-15', 'activo'),
      (3, '34567890-1', 'Luis', 'Perez', '912345679', '2025-06-15', 'inactivo'),
      (4, '45678901-2', 'Pedro', 'Soto', '912345680', '2025-06-15', 'activo')
  `);

  await db.run(sql`
    INSERT INTO usuario (
      usuario_id,
      usuario_rol,
      usuario_fecha_creacion,
      trabajador_id
    )
    VALUES
      ('12345678-9', 'dueño', '2026-01-01T00:00:00.000Z', 1),
      ('23456789-0', 'cajero', '2026-01-01T00:00:00.000Z', 2),
      ('34567890-1', 'cajero', '2026-01-01T00:00:00.000Z', 3),
      ('45678901-2', 'reponedor', '2026-01-01T00:00:00.000Z', 4)
  `);
}

async function seedShift(db: DbExecutor, trabajadorId: number): Promise<void> {
  await db.run(sql`
    INSERT INTO turno (
      turno_id,
      turno_fecha_hora_inicio,
      turno_fecha_hora_fin,
      turno_estado,
      trabajador_id
    )
    VALUES (
      '00000000-0000-4000-8000-000000000201',
      '2026-06-12T11:00:00.000Z',
      '2026-06-12T20:00:00.000Z',
      'planificado',
      ${trabajadorId}
    )
  `);
}

async function seedAttendance(
  db: DbExecutor,
  trabajadorId: number,
  options: { salidaAt?: string } = {},
): Promise<string> {
  const asistenciaId = randomUUID();

  await db.run(sql`
    INSERT INTO asistencia (
      asistencia_id,
      asistencia_fecha_hora_entrada,
      asistencia_fecha_hora_salida,
      trabajador_id,
      turno_id
    )
    VALUES (
      ${asistenciaId},
      '2026-06-12T12:00:00.000Z',
      ${options.salidaAt ?? null},
      ${trabajadorId},
      NULL
    )
  `);

  return asistenciaId;
}

async function seedAbsence(db: DbExecutor, trabajadorId: number): Promise<void> {
  await db.run(sql`
    INSERT INTO ausencia (
      ausencia_id,
      ausencia_fecha,
      ausencia_tipo,
      ausencia_observacion,
      trabajador_id,
      usuario_registrador_id
    )
    VALUES (
      ${randomUUID()},
      '2026-06-12',
      'justificada',
      'Permiso registrado',
      ${trabajadorId},
      '12345678-9'
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
