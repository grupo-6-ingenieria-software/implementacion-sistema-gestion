import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  annulSale,
  SaleAnnulmentBusinessError,
  SaleAnnulmentNotFoundError,
  SaleAnnulmentValidationError,
} from "../../../src/main/controllers/sale-annulment-service";
import {
  closeCashRegister,
  getCashClosingSummary,
} from "../../../src/main/controllers/cash-closing-service";
import { loadDailySalesSummary } from "../../../src/main/controllers/dashboard-queries";
import {
  loadDailySalesHistory,
  loadSaleDetail,
} from "../../../src/main/controllers/sales-history";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const saleId = "00000000-0000-4000-8000-000000000401";
const now = new Date("2026-06-12T18:00:00.000Z");
const dialect = new SQLiteSyncDialect();
let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedFixture(testDb.db as unknown as DbExecutor);
});

afterEach(async () => {
  if (!testDb) return;
  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe("CU38 sale annulment service", () => {
  it("loads the historical price, discount, payment and associated cash", async () => {
    const detail = await loadSaleDetail(testDb!.db, { ventaId: saleId });

    expect(detail).toMatchObject({
      ventaId: saleId,
      estado: "confirmada",
      responsable: {
        usuarioId: "12345678-9",
        nombre: "Maria Huascar",
        rol: "dueno",
      },
      productos: [
        {
          nombre: "Pan",
          cantidad: 3,
          precioUnitario: 1000,
          subtotal: 3000,
        },
      ],
      descuento: { tipo: "monto", valor: 500, razon: "Promoción" },
      pago: { metodo: "efectivo", montoRecibido: 3000, vuelto: 500 },
      subtotal: 3000,
      total: 2500,
      caja: {
        cierreCajaId: "00000000-0000-4000-8000-000000000201",
        estado: "abierta",
      },
    });
  });

  it("restores every consumed lot exactly once and preserves sale history", async () => {
    const result = await annulSale(
      testDb!.db as unknown as DbExecutor,
      {
        ventaId: saleId,
        razon: "  Cliente devolvió la compra  ",
        usuarioId: "12345678-9",
      },
      now,
    );

    expect(result).toMatchObject({
      ventaId: saleId,
      fechaHora: now.toISOString(),
      razon: "Cliente devolvió la compra",
      responsable: { usuarioId: "12345678-9", nombre: "Maria Huascar" },
      lotesRestituidos: 2,
      unidadesRestituidas: 3,
    });

    const state = await readPersistedState(testDb!.db as unknown as DbExecutor);
    expect(state.sale).toEqual({ estado: "anulada", discountValue: 500 });
    expect(state.lots).toEqual([
      { loteId: "00000000-0000-4000-8000-000000000101", cantidad: 10 },
      { loteId: "00000000-0000-4000-8000-000000000102", cantidad: 10 },
    ]);
    expect(state.counts).toEqual({
      anulaciones: 1,
      auditorias: 1,
      detalles: 1,
      consumos: 2,
      pagos: 1,
    });
    expect(state.annulment).toEqual({
      razon: "Cliente devolvió la compra",
      usuarioId: "12345678-9",
      fechaHora: now.toISOString(),
    });

    const dashboard = await loadDailySalesSummary(testDb!.db, now);
    const history = await loadDailySalesHistory(testDb!.db, now);
    const cash = await getCashClosingSummary(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: "12345678-9" },
      now,
    );
    expect(dashboard).toMatchObject({
      currentAmount: 0,
      currentTransactions: 0,
      voidedAmount: 2500,
      voidedTransactions: 1,
    });
    expect(history.resumen).toMatchObject({
      ventasVigentes: 0,
      montoVigente: 0,
      ventasAnuladas: 1,
      montoAnulado: 2500,
    });
    expect(cash).toMatchObject({
      currentAmount: 0,
      currentTransactions: 0,
      voidedAmount: 2500,
      voidedTransactions: 1,
    });

    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        {
          ventaId: saleId,
          razon: "Segundo intento",
          usuarioId: "12345678-9",
        },
        now,
      ),
    ).rejects.toBeInstanceOf(SaleAnnulmentBusinessError);

    expect(
      (await readPersistedState(testDb!.db as unknown as DbExecutor)).lots,
    ).toEqual(state.lots);
  });

  it("accepts an active worker and records that worker as responsible", async () => {
    await testDb!.db.run(sql`
      UPDATE usuario SET usuario_rol = 'trabajador'
      WHERE usuario_id = '12345678-9'
    `);

    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        {
          ventaId: saleId,
          razon: "Error de cobro",
          usuarioId: "12345678-9",
        },
        now,
      ),
    ).resolves.toMatchObject({
      responsable: { usuarioId: "12345678-9", nombre: "Maria Huascar" },
    });
  });

  it("rejects malformed input before starting any write", async () => {
    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        { ventaId: "venta-1", razon: "Motivo", usuarioId: "12345678-9" },
        now,
      ),
    ).rejects.toBeInstanceOf(SaleAnnulmentValidationError);
    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        { ventaId: saleId, razon: "   ", usuarioId: "12345678-9" },
        now,
      ),
    ).rejects.toBeInstanceOf(SaleAnnulmentValidationError);

    expect(
      (await readPersistedState(testDb!.db as unknown as DbExecutor)).counts
        .anulaciones,
    ).toBe(0);
  });

  it("distinguishes a missing sale and a previous-day sale", async () => {
    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        {
          ventaId: "00000000-0000-4000-8000-000000000499",
          razon: "Motivo",
          usuarioId: "12345678-9",
        },
        now,
      ),
    ).rejects.toBeInstanceOf(SaleAnnulmentNotFoundError);

    await testDb!.db.run(sql`
      UPDATE venta SET venta_fecha_hora = '2026-06-11T12:00:00.000Z'
      WHERE venta_id = ${saleId}
    `);
    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        {
          ventaId: saleId,
          razon: "Motivo",
          usuarioId: "12345678-9",
        },
        now,
      ),
    ).rejects.toThrow("día actual");
  });

  it("rejects a closed associated cash register without partial changes", async () => {
    await closeAssociatedCash(testDb!.db as unknown as DbExecutor);

    await expect(
      annulSale(
        testDb!.db as unknown as DbExecutor,
        {
          ventaId: saleId,
          razon: "Cliente solicita anulación",
          usuarioId: "12345678-9",
        },
        now,
      ),
    ).rejects.toThrow("caja asociada");

    const state = await readPersistedState(testDb!.db as unknown as DbExecutor);
    expect(state.sale.estado).toBe("completada");
    expect(state.lots.map((lot) => lot.cantidad)).toEqual([9, 8]);
    expect(state.counts.anulaciones).toBe(0);
    expect(state.counts.auditorias).toBe(0);
  });

  it("rolls back stock, state and annulment when auditing fails", async () => {
    const base = testDb!.db as unknown as DbExecutor;
    const failingDatabase: DbExecutor = {
      all: base.all.bind(base),
      run: base.run.bind(base),
      transaction: (callback) =>
        base.transaction((tx) =>
          callback({
            all: tx.all.bind(tx),
            transaction: tx.transaction.bind(tx),
            run: async (query: SQL) => {
              if (dialect.sqlToQuery(query).sql.includes("log_auditoria")) {
                throw new Error("audit failure");
              }
              return tx.run(query);
            },
          }),
        ),
    };

    await expect(
      annulSale(
        failingDatabase,
        {
          ventaId: saleId,
          razon: "Motivo válido",
          usuarioId: "12345678-9",
        },
        now,
      ),
    ).rejects.toThrow("audit failure");

    const state = await readPersistedState(base);
    expect(state.sale.estado).toBe("completada");
    expect(state.lots.map((lot) => lot.cantidad)).toEqual([9, 8]);
    expect(state.counts.anulaciones).toBe(0);
    expect(state.counts.auditorias).toBe(0);
  });

  it("serializes two concurrent annulments so stock is restored once", async () => {
    const secondClient = createClient({ url: testDb!.url });
    await secondClient.execute("PRAGMA foreign_keys = ON");
    await secondClient.execute("PRAGMA busy_timeout = 3000");
    const secondDb = drizzle(secondClient, { schema });

    try {
      const attempts = await Promise.allSettled([
        annulSale(
          testDb!.db as unknown as DbExecutor,
          {
            ventaId: saleId,
            razon: "Primer intento",
            usuarioId: "12345678-9",
          },
          now,
        ),
        annulSale(
          secondDb as unknown as DbExecutor,
          {
            ventaId: saleId,
            razon: "Segundo intento",
            usuarioId: "12345678-9",
          },
          now,
        ),
      ]);

      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
      expect(
        attempts.find((attempt) => attempt.status === "rejected"),
      ).toMatchObject({ reason: expect.any(SaleAnnulmentBusinessError) });

      const state = await readPersistedState(
        testDb!.db as unknown as DbExecutor,
      );
      expect(state.lots.map((lot) => lot.cantidad)).toEqual([10, 10]);
      expect(state.counts.anulaciones).toBe(1);
    } finally {
      secondClient.close();
    }
  });

  it("keeps a coherent outcome when cash closing and annulment compete", async () => {
    const secondClient = createClient({ url: testDb!.url });
    await secondClient.execute("PRAGMA foreign_keys = ON");
    await secondClient.execute("PRAGMA busy_timeout = 3000");
    const secondDb = drizzle(secondClient, { schema });

    try {
      const [closeResult, annulResult] = await Promise.allSettled([
        closeCashRegister(
          secondDb as unknown as DbExecutor,
          { confirmacion: true, usuarioId: "12345678-9" },
          now,
        ),
        annulSale(
          testDb!.db as unknown as DbExecutor,
          {
            ventaId: saleId,
            razon: "Anulación concurrente",
            usuarioId: "12345678-9",
          },
          now,
        ),
      ]);

      expect(closeResult.status).toBe("fulfilled");
      const state = await readPersistedState(
        testDb!.db as unknown as DbExecutor,
      );
      const [cash] = await testDb!.db.all<{ estado: string }>(sql`
        SELECT cierre_estado AS estado FROM cierre_caja LIMIT 1
      `);
      expect(cash.estado).toBe("cerrado");

      if (annulResult.status === "fulfilled") {
        expect(state.sale.estado).toBe("anulada");
        expect(state.lots.map((lot) => lot.cantidad)).toEqual([10, 10]);
        expect(state.counts.anulaciones).toBe(1);
      } else {
        expect(annulResult.reason).toBeInstanceOf(SaleAnnulmentBusinessError);
        expect(state.sale.estado).toBe("completada");
        expect(state.lots.map((lot) => lot.cantidad)).toEqual([9, 8]);
        expect(state.counts.anulaciones).toBe(0);
      }
    } finally {
      secondClient.close();
    }
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-cu38-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA busy_timeout = 3000");
  await applyMigrations(client);
  await client.executeMultiple(
    await readFile(join(process.cwd(), "src/db/triggers.sql"), "utf8"),
  );

  return { client, db, dir, url: `file:${dbPath}` };
}

async function seedFixture(db: DbExecutor): Promise<void> {
  await db.run(sql`
    INSERT INTO trabajador (
      trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
      trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado
    ) VALUES (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo')
  `);
  await db.run(sql`
    INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1)
  `);
  await db.run(sql`
    INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Abarrotes', 0)
  `);
  await db.run(sql`
    INSERT INTO producto (
      producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
      producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id
    ) VALUES (1, '7802920000015', 'Pan', 1800, 1, 'activo', '2026-01-01T00:00:00.000Z', 1)
  `);
  await db.run(sql`
    INSERT INTO historial_precio_producto (
      historial_precio_producto_id, historial_precio_costo,
      historial_precio_venta, historial_fecha_hora_vigencia_desde, producto_id
    ) VALUES (
      '00000000-0000-4000-8000-000000000301', 700, 1000,
      '2026-01-01T00:00:00.000Z', 1
    )
  `);
  await db.run(sql`
    INSERT INTO cierre_caja (
      cierre_caja_id, cierre_fecha_hora_inicio, cierre_estado
    ) VALUES (
      '00000000-0000-4000-8000-000000000201',
      '2026-06-12T08:00:00.000Z', 'abierto'
    )
  `);
  await db.run(sql`
    INSERT INTO lote (
      lote_id, lote_cantidad_inicial, lote_cantidad_actual, lote_precio_costo,
      lote_fecha_hora_ingreso, es_lote_perecible, es_lote_no_perecible,
      producto_id
    ) VALUES
      ('00000000-0000-4000-8000-000000000101', 10, 9, 700,
       '2026-01-01T00:00:00.000Z', 0, 1, 1),
      ('00000000-0000-4000-8000-000000000102', 10, 8, 700,
       '2026-02-01T00:00:00.000Z', 0, 1, 1)
  `);
  await db.run(sql`
    INSERT INTO venta (
      venta_id, venta_fecha_hora, venta_descuento_tipo,
      venta_descuento_valor, venta_descuento_razon, venta_metodo_pago,
      venta_estado, es_venta_efectivo, es_venta_electronica,
      usuario_cajero_id, venta_responsable_nombre, venta_responsable_rol,
      cierre_caja_id
    ) VALUES (
      ${saleId}, '2026-06-12T12:00:00.000Z', 'monto', 500,
      'Promoción', 'efectivo', 'completada', 1, 0,
      '12345678-9', 'Maria Huascar', 'dueno',
      '00000000-0000-4000-8000-000000000201'
    )
  `);
  await db.run(sql`
    INSERT INTO detalle_venta (
      detalle_venta_id, venta_id, producto_id, detalle_venta_cantidad,
      historial_precio_producto_id
    ) VALUES (
      '00000000-0000-4000-8000-000000000501', ${saleId}, 1, 3,
      '00000000-0000-4000-8000-000000000301'
    )
  `);
  await db.run(sql`
    INSERT INTO venta_efectivo (venta_id, venta_efectivo_monto_recibido)
    VALUES (${saleId}, 3000)
  `);
  await db.run(sql`
    INSERT INTO venta_lote (
      venta_lote_id, venta_id, lote_id, venta_lote_cantidad_consumida
    ) VALUES
      ('00000000-0000-4000-8000-000000000601', ${saleId},
       '00000000-0000-4000-8000-000000000101', 1),
      ('00000000-0000-4000-8000-000000000602', ${saleId},
       '00000000-0000-4000-8000-000000000102', 2)
  `);
}

async function closeAssociatedCash(db: DbExecutor): Promise<void> {
  await db.run(sql`
    UPDATE cierre_caja
    SET cierre_estado = 'cerrado',
        cierre_fecha_hora_fin = '2026-06-12T17:00:00.000Z',
        usuario_cierre_id = '12345678-9'
    WHERE cierre_caja_id = '00000000-0000-4000-8000-000000000201'
  `);
}

async function readPersistedState(db: DbExecutor) {
  const [sale] = await db.all<{ estado: string; discountValue: number }>(sql`
    SELECT venta_estado AS estado, venta_descuento_valor AS discountValue
    FROM venta WHERE venta_id = ${saleId}
  `);
  const lots = await db.all<{ loteId: string; cantidad: number }>(sql`
    SELECT lote_id AS loteId, lote_cantidad_actual AS cantidad
    FROM lote ORDER BY lote_id
  `);
  const [counts] = await db.all<{
    anulaciones: number;
    auditorias: number;
    detalles: number;
    consumos: number;
    pagos: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM anulacion_venta) AS anulaciones,
      (SELECT COUNT(*) FROM log_auditoria) AS auditorias,
      (SELECT COUNT(*) FROM detalle_venta) AS detalles,
      (SELECT COUNT(*) FROM venta_lote) AS consumos,
      (SELECT COUNT(*) FROM venta_efectivo) AS pagos
  `);
  const [annulment] = await db.all<{
    razon: string;
    usuarioId: string;
    fechaHora: string;
  }>(sql`
    SELECT anulacion_razon AS razon, usuario_id AS usuarioId,
      anulacion_fecha_hora AS fechaHora
    FROM anulacion_venta LIMIT 1
  `);

  return {
    sale: { ...sale, discountValue: Number(sale.discountValue) },
    lots: lots.map((lot) => ({ ...lot, cantidad: Number(lot.cantidad) })),
    counts: {
      anulaciones: Number(counts.anulaciones),
      auditorias: Number(counts.auditorias),
      detalles: Number(counts.detalles),
      consumos: Number(counts.consumos),
      pagos: Number(counts.pagos),
    },
    annulment,
  };
}

async function applyMigrations(
  client: ReturnType<typeof createClient>,
): Promise<void> {
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrationFiles) {
    await client.executeMultiple(
      await readFile(join(migrationsDir, file), "utf8"),
    );
  }
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
