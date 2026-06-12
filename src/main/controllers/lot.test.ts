import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { AccessDeniedError } from './auth-context';
import {
  createLotController,
  registerLotWithExecutor,
  type LotError,
} from './lot';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedLotFixture(testDb.db);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('lot controller', () => {
  it('maps authorization failures to forbidden responses', async () => {
    const controller = createLotController({
      prepare: async () => ({ providers: [] }),
      register: async () => {
        throw new AccessDeniedError();
      },
    });

    const response = await controller.handle(
      {
        ean13: '7802920000015',
        cantidad: 10,
        precioCosto: 700,
        proveedorId: 1,
        usuarioId: 'trabajador',
      },
      { channel: 'lote:registrar' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden lot response');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });

  it('registers a non-perishable lot, movement and audit log', async () => {
    const result = await testDb!.db.transaction((tx) =>
      registerLotWithExecutor(tx, schema, {
        ean13: '7802920000022',
        cantidad: 24,
        precioCosto: 900,
        proveedorId: 1,
        usuarioId: '12345678-9',
      }),
    );

    const rows = await testDb!.db.all<{
      loteId: string;
      perecible: number;
      noPerecible: number;
      cantidadActual: number;
      movimientos: number;
      auditorias: number;
    }>(sql`
      SELECT
        l.lote_id AS loteId,
        l.es_lote_perecible AS perecible,
        l.es_lote_no_perecible AS noPerecible,
        l.lote_cantidad_actual AS cantidadActual,
        (SELECT COUNT(*) FROM ajuste_inventario ai WHERE ai.lote_id = l.lote_id) AS movimientos,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias
      FROM lote l
      WHERE l.lote_id = ${result.loteId}
    `);

    expect(result.ean13).toBe('7802920000022');
    expect(rows[0]).toMatchObject({
      perecible: 0,
      noPerecible: 1,
      cantidadActual: 24,
      movimientos: 1,
      auditorias: 1,
    });
  });

  it('registers a perishable lot with expiration subtype', async () => {
    const result = await testDb!.db.transaction((tx) =>
      registerLotWithExecutor(tx, schema, {
        ean13: '7802920000015',
        cantidad: 10,
        precioCosto: 700,
        fechaVencimiento: '2027-01-01',
        proveedorId: 1,
        usuarioId: '12345678-9',
      }),
    );

    const rows = await testDb!.db.all<{
      fechaVencimiento: string;
    }>(sql`
      SELECT lote_perecible_fecha_vencimiento AS fechaVencimiento
      FROM lote_perecible
      WHERE lote_id = ${result.loteId}
    `);

    expect(rows).toEqual([{ fechaVencimiento: '2027-01-01' }]);
  });

  it('rejects inactive products and missing providers', async () => {
    await expect(
      testDb!.db.transaction((tx) =>
        registerLotWithExecutor(tx, schema, {
          ean13: '7802920000039',
          cantidad: 10,
          precioCosto: 700,
          proveedorId: 1,
          usuarioId: '12345678-9',
        }),
      ),
    ).rejects.toMatchObject({
      reason: 'product-not-found',
    } satisfies Partial<LotError>);

    await expect(
      testDb!.db.transaction((tx) =>
        registerLotWithExecutor(tx, schema, {
          ean13: '7802920000022',
          cantidad: 10,
          precioCosto: 700,
          proveedorId: 999,
          usuarioId: '12345678-9',
        }),
      ),
    ).rejects.toMatchObject({
      reason: 'provider-not-found',
    } satisfies Partial<LotError>);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-lot-'));
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

async function seedLotFixture(db: TestDatabase['db']): Promise<void> {
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
    VALUES ('12345678-9', 'dueño', '2026-01-01T00:00:00.000Z', 1)
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
    INSERT INTO proveedor (
      proveedor_id,
      proveedor_rut,
      proveedor_nombre_razon_social,
      proveedor_nombre_contacto,
      proveedor_telefono,
      proveedor_correo_electronico
    )
    VALUES (
      1,
      '76543210-K',
      'Distribuidora Central S.A.',
      'Juan Perez',
      '912345678',
      'ventas@distribuidora.cl'
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
