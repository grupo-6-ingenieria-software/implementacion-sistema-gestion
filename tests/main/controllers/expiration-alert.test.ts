import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/db/schema';
import {
  loadExpirationAlerts,
  type DashboardDb,
} from '../../../src/main/controllers/dashboard-service';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedExpirationFixture(testDb.db as unknown as DashboardDb);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('expiration alerts integration', () => {
  it('loads only active lots with stock in the expiration horizon', async () => {
    const result = await loadExpirationAlerts(
      testDb!.db as unknown as DashboardDb,
      new Date('2026-06-12T12:00:00Z'),
    );

    expect(result.expired.map((alert) => alert.lotId)).toEqual([
      '00000000-0000-4000-8000-000000000101',
    ]);
    expect(result.expiringSoon.map((alert) => alert.lotId)).toEqual([
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
    ]);
    expect(result.expiringSoon.map((alert) => alert.daysRemaining)).toEqual([
      0,
      7,
    ]);
    expect(
      [...result.expired, ...result.expiringSoon].map((alert) => ({
        ean13: alert.ean13,
        productName: alert.productName,
        quantity: alert.availableQuantity,
      })),
    ).toEqual([
      {
        ean13: '7802920000015',
        productName: 'Leche 1L',
        quantity: 4,
      },
      {
        ean13: '7802920000015',
        productName: 'Leche 1L',
        quantity: 5,
      },
      {
        ean13: '7802920000015',
        productName: 'Leche 1L',
        quantity: 6,
      },
    ]);
  });
});

describe('expiration alert controller', () => {
  it('returns a controlled technical error when the query fails', async () => {
    vi.resetModules();
    vi.doMock('../../../src/db/client', () => ({
      db: {
        all: vi.fn().mockRejectedValue(new Error('db unavailable')),
      },
    }));

    const { expirationAlertController } = await import(
      '../../../src/main/controllers/expiration-alert'
    );

    await expect(
      expirationAlertController.handle(
        {},
        { channel: 'dashboard:alertas-vencimiento' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TECHNICAL_ERROR',
        controllerId: 'expiration-alert',
        message: 'No fue posible cargar la informacion solicitada.',
      },
    });

    vi.doUnmock('../../../src/db/client');
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-expiration-'));
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

async function seedExpirationFixture(db: DashboardDb): Promise<void> {
  await db.all(sql`
    INSERT INTO categoria (
      categoria_id,
      categoria_nombre,
      categoria_exige_vencimiento
    )
    VALUES (1, 'Lacteos', 1)
  `);

  await db.all(sql`
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
      (2, '7802920000022', 'Yogur inactivo', 900, 1, 'inactivo', '2026-01-01T00:00:00.000Z', 1)
  `);

  await db.all(sql`
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
      ('00000000-0000-4000-8000-000000000101', 4, 4, 700, '2026-06-01T08:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000102', 5, 5, 700, '2026-06-02T08:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000103', 6, 6, 700, '2026-06-03T08:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000104', 7, 7, 700, '2026-06-04T08:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000105', 8, 0, 700, '2026-06-05T08:00:00.000Z', 1, 0, 1),
      ('00000000-0000-4000-8000-000000000106', 9, 9, 700, '2026-06-06T08:00:00.000Z', 1, 0, 2)
  `);

  await db.all(sql`
    INSERT INTO lote_perecible (
      lote_id,
      lote_perecible_fecha_vencimiento
    )
    VALUES
      ('00000000-0000-4000-8000-000000000101', '2026-06-10'),
      ('00000000-0000-4000-8000-000000000102', '2026-06-12'),
      ('00000000-0000-4000-8000-000000000103', '2026-06-19'),
      ('00000000-0000-4000-8000-000000000104', '2026-06-20'),
      ('00000000-0000-4000-8000-000000000105', '2026-06-13'),
      ('00000000-0000-4000-8000-000000000106', '2026-06-13')
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
