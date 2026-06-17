import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../src/db/schema';
import { AccessDeniedError } from '../../../src/main/controllers/auth-context';
import {
  createWasteController,
  registerWasteWithExecutor,
  type WasteError,
} from '../../../src/main/controllers/waste';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedWasteFixture(testDb.db);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('waste controller', () => {
  it('maps authorization failures to forbidden responses', async () => {
    const controller = createWasteController({
      register: async () => {
        throw new AccessDeniedError();
      },
    });

    const response = await controller.handle(
      {
        ean13: '7802920000015',
        cantidad: 2,
        motivo: 'dano',
        usuarioId: 'trabajador',
      },
      { channel: 'merma:registrar' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden waste response');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });

  it('rejects channels not declared for the waste controller', async () => {
    const controller = createWasteController({
      register: async () => ({
        mermaId: '00000000-0000-4000-8000-000000000001',
        ean13: '7802920000015',
        cantidad: 1,
        lotesDescontados: [],
      }),
    });

    const response = await controller.handle({}, { channel: 'merma:preparar' });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected invalid channel');
    }

    expect(response.error.code).toBe('INVALID_CHANNEL');
  });

  it('registers waste and discounts perishable lots using FEFO', async () => {
    const result = await testDb!.db.transaction((tx) =>
      registerWasteWithExecutor(tx, schema, {
        ean13: '7802920000015',
        cantidad: 7,
        motivo: 'vencimiento',
        observacion: 'Fecha cercana',
        usuarioId: '12345678-9',
      }),
    );

    expect(result.ean13).toBe('7802920000015');
    expect(result.cantidad).toBe(7);
    expect(result.lotesDescontados).toEqual([
      {
        loteId: '00000000-0000-4000-8000-000000000102',
        cantidad: 5,
      },
      {
        loteId: '00000000-0000-4000-8000-000000000101',
        cantidad: 2,
      },
    ]);

    const rows = await testDb!.db.all<{
      mermaLotes: number;
      movimientos: number;
      auditorias: number;
      loteA: number;
      loteB: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM merma_lote WHERE merma_id = ${result.mermaId}) AS mermaLotes,
        (SELECT COUNT(*) FROM ajuste_inventario WHERE ajuste_cantidad < 0) AS movimientos,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias,
        (SELECT lote_cantidad_actual FROM lote WHERE lote_id = '00000000-0000-4000-8000-000000000101') AS loteA,
        (SELECT lote_cantidad_actual FROM lote WHERE lote_id = '00000000-0000-4000-8000-000000000102') AS loteB
    `);

    expect(rows[0]).toMatchObject({
      mermaLotes: 2,
      movimientos: 2,
      auditorias: 1,
      loteA: 3,
      loteB: 0,
    });
  });

  it('discounts non-perishable lots by entry date', async () => {
    const result = await testDb!.db.transaction((tx) =>
      registerWasteWithExecutor(tx, schema, {
        ean13: '7802920000022',
        cantidad: 8,
        motivo: 'error_registro',
        usuarioId: '12345678-9',
      }),
    );

    expect(result.lotesDescontados).toEqual([
      {
        loteId: '00000000-0000-4000-8000-000000000201',
        cantidad: 3,
      },
      {
        loteId: '00000000-0000-4000-8000-000000000202',
        cantidad: 5,
      },
    ]);
  });

  it('rejects inactive products and insufficient stock without partial writes', async () => {
    await expect(
      testDb!.db.transaction((tx) =>
        registerWasteWithExecutor(tx, schema, {
          ean13: '7802920000039',
          cantidad: 1,
          motivo: 'dano',
          usuarioId: '12345678-9',
        }),
      ),
    ).rejects.toMatchObject({
      reason: 'product-not-found',
    } satisfies Partial<WasteError>);

    await expect(
      testDb!.db.transaction((tx) =>
        registerWasteWithExecutor(tx, schema, {
          ean13: '7802920000022',
          cantidad: 99,
          motivo: 'error_registro',
          usuarioId: '12345678-9',
        }),
      ),
    ).rejects.toMatchObject({
      reason: 'stock-insufficient',
    } satisfies Partial<WasteError>);

    const rows = await testDb!.db.all<{
      mermas: number;
      mermaLotes: number;
      movimientos: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM merma) AS mermas,
        (SELECT COUNT(*) FROM merma_lote) AS mermaLotes,
        (SELECT COUNT(*) FROM ajuste_inventario WHERE ajuste_cantidad < 0) AS movimientos
    `);

    expect(rows[0]).toEqual({
      mermas: 0,
      mermaLotes: 0,
      movimientos: 0,
    });
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-waste-'));
  const dbPath = join(dir, 'test.db').replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute('PRAGMA foreign_keys = ON');
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

async function seedWasteFixture(db: TestDatabase['db']): Promise<void> {
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
    VALUES (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo')
  `);

  await db.run(sql`
    INSERT INTO usuario (
      usuario_id,
      usuario_rol,
      usuario_fecha_creacion,
      trabajador_id
    )
    VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1)
  `);

  await db.run(sql`
    INSERT INTO categoria (
      categoria_id,
      categoria_nombre,
      categoria_exige_vencimiento
    )
    VALUES
      (1, 'Lacteos', 1),
      (2, 'Bebidas', 0)
  `);

  await db.run(sql`
    INSERT INTO producto (
      producto_id,
      producto_ean_13,
      producto_nombre,
      producto_precio_venta,
      producto_stock_minimo,
      producto_estado,
      producto_fecha_registro,
      categoria_id
    )
    VALUES
      (1, '7802920000015', 'Leche 1L', 1000, 1, 'activo', '2026-01-01T00:00:00.000Z', 1),
      (2, '7802920000022', 'Bebida 1.5L', 1500, 1, 'activo', '2026-01-01T00:00:00.000Z', 2),
      (3, '7802920000039', 'Producto inactivo', 1500, 1, 'inactivo', '2026-01-01T00:00:00.000Z', 2)
  `);

  await db.run(sql`
    INSERT INTO lote (
      lote_id,
      lote_cantidad_inicial,
      lote_cantidad_actual,
      lote_precio_costo,
      lote_fecha_hora_ingreso,
      es_lote_perecible,
      es_lote_no_perecible,
      producto_id
    )
    VALUES
      ('00000000-0000-4000-8000-000000000101', 5, 5, 700, '2026-01-01T00:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000102', 5, 5, 700, '2026-02-01T00:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000103', 5, 5, 700, '2026-03-01T00:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000201', 3, 3, 800, '2026-01-10T00:00:00.000Z', 0, 1, 2),
      ('00000000-0000-4000-8000-000000000202', 7, 7, 800, '2026-02-10T00:00:00.000Z', 0, 1, 2)
  `);

  await db.run(sql`
    INSERT INTO lote_perecible (
      lote_id,
      lote_perecible_fecha_vencimiento
    )
    VALUES
      ('00000000-0000-4000-8000-000000000101', '2027-02-01'),
      ('00000000-0000-4000-8000-000000000102', '2027-01-01'),
      ('00000000-0000-4000-8000-000000000103', '2027-03-01')
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
