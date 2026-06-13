import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../src/db/schema';
import {
  registerSale,
  SaleBusinessError,
  type DbExecutor,
} from '../../../src/main/controllers/sale-service';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedSaleFixture(testDb.db as unknown as DbExecutor);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('registerSale', () => {
  it('registers a cash sale, creates details and consumes FEFO lots', async () => {
    const receipt = await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: '12345678-9',
      metodoPago: 'efectivo',
      montoRecibido: 5000,
      items: [{ productoId: 1, ean13: '7802920000015', cantidad: 3 }],
    });

    expect(receipt.total).toBe(3000);
    expect(receipt.vuelto).toBe(2000);
    expect(receipt.detalle[0].lotesConsumidos).toEqual([
      { loteId: '00000000-0000-4000-8000-000000000101', cantidad: 1 },
      { loteId: '00000000-0000-4000-8000-000000000102', cantidad: 2 },
    ]);

    const ventaRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta`,
    );
    const detalleRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM detalle_venta`,
    );
    const efectivoRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta_efectivo`,
    );
    const lotRows = await testDb!.db.all<{
      loteId: string;
      cantidadActual: number;
    }>(sql`
      SELECT lote_id AS loteId, lote_cantidad_actual AS cantidadActual
      FROM lote
      ORDER BY lote_id ASC
    `);

    expect(Number(ventaRows[0].count)).toBe(1);
    expect(Number(detalleRows[0].count)).toBe(1);
    expect(Number(efectivoRows[0].count)).toBe(1);
    expect(lotRows).toEqual([
      {
        loteId: '00000000-0000-4000-8000-000000000101',
        cantidadActual: 0,
      },
      {
        loteId: '00000000-0000-4000-8000-000000000102',
        cantidadActual: 3,
      },
    ]);
  });

  it('registers an electronic sale without venta_efectivo', async () => {
    await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: '12345678-9',
      metodoPago: 'debito',
      items: [{ productoId: 1, cantidad: 2 }],
    });

    const efectivoRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta_efectivo`,
    );

    expect(Number(efectivoRows[0].count)).toBe(0);
  });

  it('rolls back when cash payment is insufficient', async () => {
    await expect(
      registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: '12345678-9',
        metodoPago: 'efectivo',
        montoRecibido: 500,
        items: [{ productoId: 1, cantidad: 2 }],
      }),
    ).rejects.toBeInstanceOf(SaleBusinessError);

    const ventaRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta`,
    );
    const stockRows = await testDb!.db.all<{ stock: number }>(sql`
      SELECT SUM(lote_cantidad_actual) AS stock
      FROM lote
      WHERE producto_id = 1
    `);

    expect(Number(ventaRows[0].count)).toBe(0);
    expect(Number(stockRows[0].stock)).toBe(6);
  });

  it('blocks a sale when cash register is closed', async () => {
    await testDb!.db.run(sql`UPDATE cierre_caja SET cierre_estado = 'cerrado',
      cierre_fecha_hora_fin = '2026-06-12T20:00:00.000Z',
      usuario_cierre_id = '12345678-9'`);

    await expect(
      registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: '12345678-9',
        metodoPago: 'credito',
        items: [{ productoId: 1, cantidad: 1 }],
      }),
    ).rejects.toBeInstanceOf(SaleBusinessError);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-sale-'));
  const dbPath = join(dir, 'test.db').replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute('PRAGMA foreign_keys = ON');
  await applyMigrations(client);

  return { client, db, dir };
}

async function seedSaleFixture(db: DbExecutor): Promise<void> {
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
    VALUES (1, 'Lacteos', 1)
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
    VALUES (
      1,
      '7802920000015',
      'Leche 1L',
      1000,
      1,
      'activo',
      '2026-01-01T00:00:00.000Z',
      1
    )
  `);

  await db.run(sql`
    INSERT INTO historial_precio_producto (
      historial_precio_producto_id,
      historial_precio_costo,
      historial_precio_venta,
      historial_fecha_hora_vigencia_desde,
      producto_id
    )
    VALUES (
      ${randomUUID()},
      700,
      1000,
      '2026-01-01T00:00:00.000Z',
      1
    )
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
      ('00000000-0000-4000-8000-000000000101', 1, 1, 700, '2026-01-01T00:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000102', 5, 5, 700, '2026-01-02T00:00:00.000Z', 1, 0, 1)
  `);

  await db.run(sql`
    INSERT INTO lote_perecible (
      lote_id,
      lote_perecible_fecha_vencimiento
    )
    VALUES
      ('00000000-0000-4000-8000-000000000101', '2026-07-01'),
      ('00000000-0000-4000-8000-000000000102', '2026-08-01')
  `);

  await db.run(sql`
    INSERT INTO cierre_caja (
      cierre_caja_id,
      cierre_fecha_hora_inicio,
      cierre_estado
    )
    VALUES (
      '00000000-0000-4000-8000-000000000201',
      '2026-06-12T08:00:00.000Z',
      'abierto'
    )
  `);
}

async function applyMigrations(
  client: ReturnType<typeof createClient>,
): Promise<void> {
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
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
