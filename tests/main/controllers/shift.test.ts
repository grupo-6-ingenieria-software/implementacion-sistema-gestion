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
  ShiftAccessError,
  ShiftBusinessError,
  createShift,
  deleteShift,
  editShift,
  listShifts,
} from '../../../src/main/controllers/shift';
import { registerAttendanceEntry } from '../../../src/main/controllers/attendance-service';
import type { DbExecutor } from '../../../src/main/controllers/sale-service';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;
const ownerActor = {
  role: 'dueno' as const,
  usuarioId: '12345678-9',
};

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedFixture(testDb.db as unknown as DbExecutor);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('shift service', () => {
  it('creates a shift for an active worker and audits it', async () => {
    const result = await createShift(testDb!.db as unknown as DbExecutor, {
      trabajadorId: 2,
      fecha: '15/06/2026',
      horaInicio: '08:00',
      horaTermino: '16:00',
    }, ownerActor);
    const rows = await testDb!.db.all<{
      count: number;
      estado: string;
      inicioAt: string;
    }>(sql`
      SELECT
        turno_estado AS estado,
        turno_fecha_hora_inicio AS inicioAt,
        (SELECT COUNT(*) FROM log_auditoria WHERE log_tipo_accion = 'crear_turno') AS count
      FROM turno
      WHERE turno_id = ${result.turnoId}
    `);

    expect(rows[0]).toMatchObject({
      count: 1,
      estado: 'planificado',
      inicioAt: '2026-06-15T12:00:00.000Z',
    });
  });

  it('rejects non-owner actors and inactive workers', async () => {
    await expect(
      createShift(testDb!.db as unknown as DbExecutor, {
        trabajadorId: 2,
        fecha: '15/06/2026',
        horaInicio: '08:00',
        horaTermino: '16:00',
      }, {
        role: 'dueno',
        usuarioId: '',
      }),
    ).rejects.toBeInstanceOf(ShiftAccessError);

    await expect(
      createShift(testDb!.db as unknown as DbExecutor, {
        trabajadorId: 3,
        fecha: '15/06/2026',
        horaInicio: '08:00',
        horaTermino: '16:00',
      }, ownerActor),
    ).rejects.toMatchObject({
      fieldErrors: {
        trabajadorId: 'Seleccione un trabajador activo.',
      },
    });
  });

  it('rejects overlaps and accepts contiguous shifts', async () => {
    await createShift(testDb!.db as unknown as DbExecutor, {
      trabajadorId: 2,
      fecha: '15/06/2026',
      horaInicio: '08:00',
      horaTermino: '12:00',
    }, ownerActor);

    await expect(
      createShift(testDb!.db as unknown as DbExecutor, {
        trabajadorId: 2,
        fecha: '15/06/2026',
        horaInicio: '11:00',
        horaTermino: '13:00',
      }, ownerActor),
    ).rejects.toBeInstanceOf(ShiftBusinessError);

    await expect(
      createShift(testDb!.db as unknown as DbExecutor, {
        trabajadorId: 2,
        fecha: '15/06/2026',
        horaInicio: '12:00',
        horaTermino: '16:00',
      }, ownerActor),
    ).resolves.toHaveProperty('turnoId');
  });

  it('lists only the selected week and worker', async () => {
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: '00000000-0000-4000-8000-000000000101',
      trabajadorId: 2,
      inicioAt: '2026-06-15T12:00:00.000Z',
      terminoAt: '2026-06-15T20:00:00.000Z',
    });
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: '00000000-0000-4000-8000-000000000102',
      trabajadorId: 4,
      inicioAt: '2026-06-16T12:00:00.000Z',
      terminoAt: '2026-06-16T20:00:00.000Z',
    });
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: '00000000-0000-4000-8000-000000000103',
      trabajadorId: 2,
      inicioAt: '2026-06-22T12:00:00.000Z',
      terminoAt: '2026-06-22T20:00:00.000Z',
    });

    const result = await listShifts(
      testDb!.db as unknown as DbExecutor,
      {
        inicioSemana: '2026-06-15',
        trabajadorId: 2,
      },
      ownerActor,
      new Date('2026-06-13T12:00:00.000Z'),
    );

    expect(result.turnos.map((turno) => turno.turnoId)).toEqual([
      '00000000-0000-4000-8000-000000000101',
    ]);
    expect(result.turnos[0]).toMatchObject({
      fecha: '15/06/2026',
      horaInicio: '08:00',
      horaTermino: '16:00',
      puedeModificar: true,
    });
    expect(result.turnos[0]).not.toHaveProperty('trabajadorRut');
  });

  it('edits a future shift without conflicting with itself', async () => {
    const turnoId = '00000000-0000-4000-8000-000000000104';
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId,
      trabajadorId: 2,
      inicioAt: '2026-06-15T12:00:00.000Z',
      terminoAt: '2026-06-15T20:00:00.000Z',
    });

    await editShift(
      testDb!.db as unknown as DbExecutor,
      {
        turnoId,
        fecha: '16/06/2026',
        horaInicio: '09:00',
        horaTermino: '17:00',
      },
      ownerActor,
      new Date('2026-06-13T12:00:00.000Z'),
    );
    const rows = await testDb!.db.all<{ inicioAt: string; audits: number }>(sql`
      SELECT
        turno_fecha_hora_inicio AS inicioAt,
        (SELECT COUNT(*) FROM log_auditoria WHERE log_tipo_accion = 'editar_turno') AS audits
      FROM turno
      WHERE turno_id = ${turnoId}
    `);

    expect(rows[0]).toEqual({
      inicioAt: '2026-06-16T13:00:00.000Z',
      audits: 1,
    });
  });

  it('rejects an edit that conflicts with another shift', async () => {
    const editedId = '00000000-0000-4000-8000-000000000108';
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: editedId,
      trabajadorId: 2,
      inicioAt: '2026-06-15T12:00:00.000Z',
      terminoAt: '2026-06-15T16:00:00.000Z',
    });
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: '00000000-0000-4000-8000-000000000109',
      trabajadorId: 2,
      inicioAt: '2026-06-15T18:00:00.000Z',
      terminoAt: '2026-06-15T22:00:00.000Z',
    });

    await expect(
      editShift(
        testDb!.db as unknown as DbExecutor,
        {
          turnoId: editedId,
          fecha: '15/06/2026',
          horaInicio: '13:00',
          horaTermino: '15:00',
        },
        ownerActor,
        new Date('2026-06-13T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ShiftBusinessError);
  });

  it('returns an empty calendar without modifying data', async () => {
    const result = await listShifts(
      testDb!.db as unknown as DbExecutor,
      { inicioSemana: '2026-06-15' },
      ownerActor,
      new Date('2026-06-13T12:00:00.000Z'),
    );

    expect(result).toEqual({
      inicioSemana: '2026-06-15',
      finSemana: '2026-06-21',
      turnos: [],
    });
  });

  it('blocks edits and deletes after start or with attendance', async () => {
    const startedId = '00000000-0000-4000-8000-000000000105';
    const attendedId = '00000000-0000-4000-8000-000000000106';
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: startedId,
      trabajadorId: 2,
      inicioAt: '2026-06-12T12:00:00.000Z',
      terminoAt: '2026-06-12T20:00:00.000Z',
    });
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId: attendedId,
      trabajadorId: 4,
      inicioAt: '2026-06-15T12:00:00.000Z',
      terminoAt: '2026-06-15T20:00:00.000Z',
    });
    await seedAttendance(testDb!.db as unknown as DbExecutor, attendedId, 4);

    await expect(
      editShift(
        testDb!.db as unknown as DbExecutor,
        {
          turnoId: startedId,
          fecha: '16/06/2026',
          horaInicio: '09:00',
          horaTermino: '17:00',
        },
        ownerActor,
        new Date('2026-06-13T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ShiftBusinessError);
    await expect(
      deleteShift(
        testDb!.db as unknown as DbExecutor,
        {
          turnoId: attendedId,
          confirmacion: true,
        },
        ownerActor,
        new Date('2026-06-13T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ShiftBusinessError);
  });

  it('physically deletes an eligible shift and audits the action', async () => {
    const turnoId = '00000000-0000-4000-8000-000000000107';
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId,
      trabajadorId: 2,
      inicioAt: '2026-06-15T12:00:00.000Z',
      terminoAt: '2026-06-15T20:00:00.000Z',
    });

    await deleteShift(
      testDb!.db as unknown as DbExecutor,
      {
        turnoId,
        confirmacion: true,
      },
      ownerActor,
      new Date('2026-06-13T12:00:00.000Z'),
    );
    const rows = await testDb!.db.all<{ shifts: number; audits: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM turno WHERE turno_id = ${turnoId}) AS shifts,
        (SELECT COUNT(*) FROM log_auditoria WHERE log_tipo_accion = 'eliminar_turno') AS audits
    `);

    expect(rows[0]).toEqual({ shifts: 0, audits: 1 });
  });

  it('does not delete a shift when confirmation is cancelled', async () => {
    const turnoId = '00000000-0000-4000-8000-000000000110';
    await seedShift(testDb!.db as unknown as DbExecutor, {
      turnoId,
      trabajadorId: 2,
      inicioAt: '2026-06-15T12:00:00.000Z',
      terminoAt: '2026-06-15T20:00:00.000Z',
    });

    await expect(
      deleteShift(
        testDb!.db as unknown as DbExecutor,
        {
          turnoId,
          confirmacion: false,
        },
        ownerActor,
        new Date('2026-06-13T12:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      fieldErrors: {
        confirmacion: 'Debe confirmar la eliminacion del turno.',
      },
    });

    const rows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM turno
      WHERE turno_id = ${turnoId}
    `);
    expect(rows[0].count).toBe(1);
  });

  it('makes a created shift available to attendance registration', async () => {
    const attendanceNow = new Date('2026-06-15T13:00:00.000Z');
    const shift = await createShift(testDb!.db as unknown as DbExecutor, {
      trabajadorId: 2,
      fecha: '15/06/2026',
      horaInicio: '08:00',
      horaTermino: '16:00',
    }, ownerActor);

    const result = await registerAttendanceEntry(
      testDb!.db as unknown as DbExecutor,
      {
        usuarioId: '12345678-9',
        trabajadorRut: '23456789-0',
      },
      attendanceNow,
    );

    expect(result.status).toBe('registered');
    if (result.status !== 'registered') {
      throw new Error(result.message);
    }
    expect(result.trabajador.turnoId).toBe(shift.turnoId);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-shift-'));
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

    if (sqlStatement) {
      await client.execute(sqlStatement);
    }
  }

  return { client, db, dir };
}

async function seedFixture(db: DbExecutor): Promise<void> {
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
      ('23456789-0', 'cajero', '2026-01-01T00:00:00.000Z', 2)
  `);
}

async function seedShift(
  db: DbExecutor,
  input: {
    turnoId: string;
    trabajadorId: number;
    inicioAt: string;
    terminoAt: string;
  },
): Promise<void> {
  await db.run(sql`
    INSERT INTO turno (
      turno_id,
      turno_fecha_hora_inicio,
      turno_fecha_hora_fin,
      turno_estado,
      trabajador_id
    )
    VALUES (
      ${input.turnoId},
      ${input.inicioAt},
      ${input.terminoAt},
      'planificado',
      ${input.trabajadorId}
    )
  `);
}

async function seedAttendance(
  db: DbExecutor,
  turnoId: string,
  trabajadorId: number,
): Promise<void> {
  await db.run(sql`
    INSERT INTO asistencia (
      asistencia_id,
      asistencia_fecha_hora_entrada,
      asistencia_fecha_hora_salida,
      trabajador_id,
      turno_id
    )
    VALUES (
      ${randomUUID()},
      '2026-06-15T12:05:00.000Z',
      NULL,
      ${trabajadorId},
      ${turnoId}
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
