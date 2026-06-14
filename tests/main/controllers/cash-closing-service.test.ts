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
  CashClosingBusinessError,
  CashClosingValidationError,
  closeCashRegister,
  getCashClosingSummary,
} from '../../../src/main/controllers/cash-closing-service';
import {
  registerSale,
  type DbExecutor,
} from '../../../src/main/controllers/sale-service';

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;
const now = new Date('2026-06-12T20:30:00.000Z');

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedCashClosingFixture(testDb.db as unknown as DbExecutor);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe('cash closing service', () => {
  it('loads a daily summary for an open cash register', async () => {
    await seedSales(testDb!.db as unknown as DbExecutor);

    const summary = await getCashClosingSummary(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: '12345678-9' },
      now,
    );

    expect(summary.status).toBe('abierta');
    expect(summary.currentAmount).toBe(5000);
    expect(summary.currentTransactions).toBe(2);
    expect(summary.voidedAmount).toBe(1000);
    expect(summary.voidedTransactions).toBe(1);
    expect(summary.payments.efectivo.currentAmount).toBe(2000);
    expect(summary.payments.debito.currentAmount).toBe(3000);
    expect(summary.payments.credito.voidedAmount).toBe(1000);
  });

  it('does not close when confirmation is cancelled', async () => {
    await expect(
      closeCashRegister(
        testDb!.db as unknown as DbExecutor,
        { confirmacion: false, usuarioId: '12345678-9' },
        now,
      ),
    ).rejects.toBeInstanceOf(CashClosingValidationError);

    const rows = await testDb!.db.all<{ status: string; closedAt: string | null }>(
      sql`
        SELECT cierre_estado AS status, cierre_fecha_hora_fin AS closedAt
        FROM cierre_caja
        LIMIT 1
      `,
    );
    const auditRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM log_auditoria`,
    );

    expect(rows[0]).toEqual({ status: 'abierto', closedAt: null });
    expect(Number(auditRows[0].count)).toBe(0);
  });

  it('closes the open cash register and registers audit data', async () => {
    await seedSales(testDb!.db as unknown as DbExecutor);

    const result = await closeCashRegister(
      testDb!.db as unknown as DbExecutor,
      { confirmacion: true, usuarioId: '12345678-9' },
      now,
    );

    expect(result.status).toBe('cerrada');
    expect(result.closedAt).toBe(now.toISOString());
    expect(result.closedBy.usuarioId).toBe('12345678-9');
    expect(result.currentAmount).toBe(5000);

    const rows = await testDb!.db.all<{
      closedAt: string;
      closedBy: string;
      status: string;
    }>(sql`
      SELECT
        cierre_estado AS status,
        cierre_fecha_hora_fin AS closedAt,
        usuario_cierre_id AS closedBy
      FROM cierre_caja
      LIMIT 1
    `);
    const auditRows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM log_auditoria
      WHERE log_tipo_accion = 'cerrar_caja'
    `);

    expect(rows[0]).toEqual({
      closedAt: now.toISOString(),
      closedBy: '12345678-9',
      status: 'cerrado',
    });
    expect(Number(auditRows[0].count)).toBe(1);
  });

  it('blocks a second close when the cash register is already closed', async () => {
    await closeCashRegister(
      testDb!.db as unknown as DbExecutor,
      { confirmacion: true, usuarioId: '12345678-9' },
      now,
    );

    await expect(
      closeCashRegister(
        testDb!.db as unknown as DbExecutor,
        { confirmacion: true, usuarioId: '12345678-9' },
        now,
      ),
    ).rejects.toBeInstanceOf(CashClosingBusinessError);

    const auditRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM log_auditoria`,
    );

    expect(Number(auditRows[0].count)).toBe(1);
  });

  it('auto-abre una caja nueva para las ventas tras un cierre exitoso (#29)', async () => {
    const before = await testDb!.db.all<{ cierreCajaId: string }>(
      sql`SELECT cierre_caja_id AS cierreCajaId FROM cierre_caja WHERE cierre_estado = 'abierto'`,
    );
    const closedCajaId = before[0]?.cierreCajaId;
    expect(closedCajaId).toBeTruthy();

    await closeCashRegister(
      testDb!.db as unknown as DbExecutor,
      { confirmacion: true, usuarioId: '12345678-9' },
      now,
    );

    // Tras el cierre la venta ya no queda bloqueada: se abre una caja nueva.
    const receipt = await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: '12345678-9',
      metodoPago: 'efectivo',
      montoRecibido: 2000,
      items: [{ productoId: 1, cantidad: 1 }],
    });
    expect(receipt.total).toBe(1000);

    const open = await testDb!.db.all<{ cierreCajaId: string }>(
      sql`SELECT cierre_caja_id AS cierreCajaId FROM cierre_caja WHERE cierre_estado = 'abierto'`,
    );
    expect(open).toHaveLength(1);
    expect(open[0].cierreCajaId).not.toBe(closedCajaId);
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'huascar-cash-'));
  const dbPath = join(dir, 'test.db').replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute('PRAGMA foreign_keys = ON');
  await applyMigrations(client);

  return { client, db, dir };
}

async function seedCashClosingFixture(db: DbExecutor): Promise<void> {
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
    VALUES (1, 'Abarrotes', 0)
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
      'Pan corriente',
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
      '00000000-0000-4000-8000-000000000301',
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
    VALUES (
      '00000000-0000-4000-8000-000000000101',
      20,
      20,
      700,
      '2026-06-12T08:00:00.000Z',
      0,
      1,
      1
    )
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

async function seedSales(db: DbExecutor): Promise<void> {
  await insertSale(db, {
    cantidad: 2,
    metodoPago: 'efectivo',
    ventaId: '00000000-0000-4000-8000-000000000401',
  });
  await insertSale(db, {
    cantidad: 3,
    metodoPago: 'debito',
    ventaId: '00000000-0000-4000-8000-000000000402',
  });
  await insertSale(db, {
    cantidad: 1,
    metodoPago: 'credito',
    ventaId: '00000000-0000-4000-8000-000000000403',
  });

  await db.run(sql`
    INSERT INTO anulacion_venta (
      anulacion_venta_id,
      anulacion_fecha_hora,
      anulacion_razon,
      venta_id,
      usuario_id
    )
    VALUES (
      ${randomUUID()},
      '2026-06-12T13:00:00.000Z',
      'Cliente solicita anulacion',
      '00000000-0000-4000-8000-000000000403',
      '12345678-9'
    )
  `);

  await db.run(sql`
    UPDATE venta
    SET venta_estado = 'anulada'
    WHERE venta_id = '00000000-0000-4000-8000-000000000403'
  `);
}

async function insertSale(
  db: DbExecutor,
  input: {
    cantidad: number;
    metodoPago: 'efectivo' | 'debito' | 'credito' | 'transferencia';
    ventaId: string;
  },
): Promise<void> {
  const esEfectivo = input.metodoPago === 'efectivo';

  await db.run(sql`
    INSERT INTO venta (
      venta_id,
      venta_fecha_hora,
      venta_descuento_tipo,
      venta_metodo_pago,
      venta_estado,
      es_venta_efectivo,
      es_venta_electronica,
      usuario_cajero_id,
      cierre_caja_id
    )
    VALUES (
      ${input.ventaId},
      '2026-06-12T12:00:00.000Z',
      'ninguno',
      ${input.metodoPago},
      'completada',
      ${esEfectivo ? 1 : 0},
      ${esEfectivo ? 0 : 1},
      '12345678-9',
      '00000000-0000-4000-8000-000000000201'
    )
  `);

  await db.run(sql`
    INSERT INTO detalle_venta (
      detalle_venta_id,
      venta_id,
      producto_id,
      detalle_venta_cantidad,
      historial_precio_producto_id
    )
    VALUES (
      ${randomUUID()},
      ${input.ventaId},
      1,
      ${input.cantidad},
      '00000000-0000-4000-8000-000000000301'
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
    } catch {
      if (attempt === 4) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
