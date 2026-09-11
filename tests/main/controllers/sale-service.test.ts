import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  registerSale,
  SaleBusinessError,
  SaleValidationError,
  validateSaleCart,
  type DbExecutor,
} from "../../../src/main/controllers/sale-service";

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

describe("registerSale", () => {
  it("validates the cart with SQL reads and performs no writes", async () => {
    const result = await validateSaleCart(testDb!.db as unknown as DbExecutor, {
      items: [{ productoId: 1, ean13: "7802920000015", cantidad: 2 }],
    });
    expect(result).toMatchObject({
      subtotal: 2000,
      lines: [{ cantidad: 2, stockDisponible: 6 }],
    });
    const counts = await testDb!.db.all<{ ventas: number; cajas: number }>(sql`
      SELECT (SELECT COUNT(*) FROM venta) AS ventas,
        (SELECT COUNT(*) FROM cierre_caja) AS cajas
    `);
    expect(counts[0]).toEqual({ ventas: 0, cajas: 1 });
  });

  it("returns available stock from read-only cart validation", async () => {
    await expect(
      validateSaleCart(testDb!.db as unknown as DbExecutor, {
        items: [{ productoId: 1, cantidad: 7 }],
      }),
    ).rejects.toThrow("Disponible: 6");
    const rows = await testDb!.db.all<{ ventas: number }>(sql`
      SELECT COUNT(*) AS ventas FROM venta
    `);
    expect(Number(rows[0].ventas)).toBe(0);
  });

  it.each([1234567890123, { valor: "7802920000015" }])(
    "rechaza EAN-13 malformado como validación contractual: %j",
    async (ean13) => {
      await expect(
        registerSale(testDb!.db as unknown as DbExecutor, {
          usuarioId: "12345678-9",
          metodoPago: "debito",
          items: [{ productoId: 1, cantidad: 1, ean13: ean13 as never }],
        }),
      ).rejects.toThrow("EAN-13");
    },
  );

  it("rechecks a closed cash register at transaction start before malformed payload rules", async () => {
    const outerAll = vi.fn().mockResolvedValueOnce([]);
    const transactionAll = vi.fn().mockResolvedValueOnce([
      {
        cierreCajaId: "caja-1",
        status: "cerrado",
        openedAt: "2026-06-12T08:00:00.000Z",
        closedAt: "2026-06-12T20:00:00.000Z",
        closedByUserId: null,
        closedByName: null,
      },
    ]);
    const tx = {
      all: transactionAll,
      run: vi.fn(),
      transaction: vi.fn(),
    } as unknown as DbExecutor;
    const database = {
      all: outerAll,
      run: vi.fn(),
      transaction: <T>(callback: (executor: DbExecutor) => Promise<T>) =>
        callback(tx),
    } as DbExecutor;
    await expect(registerSale(database, null as never)).rejects.toBeInstanceOf(
      SaleBusinessError,
    );
    expect(transactionAll).toHaveBeenCalledOnce();
    expect(tx.run).not.toHaveBeenCalled();
  });

  it("registers a cash sale, creates details and consumes FEFO lots", async () => {
    const receipt = await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: "12345678-9",
      metodoPago: "efectivo",
      montoRecibido: 5000,
      items: [{ productoId: 1, ean13: "7802920000015", cantidad: 3 }],
    });

    expect(receipt.total).toBe(3000);
    expect(receipt.vuelto).toBe(2000);
    expect(receipt.detalle[0].lotesConsumidos).toEqual([
      { loteId: "00000000-0000-4000-8000-000000000101", cantidad: 1 },
      { loteId: "00000000-0000-4000-8000-000000000102", cantidad: 2 },
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
        loteId: "00000000-0000-4000-8000-000000000101",
        cantidadActual: 0,
      },
      {
        loteId: "00000000-0000-4000-8000-000000000102",
        cantidadActual: 3,
      },
    ]);
  });

  it("registers an electronic sale without venta_efectivo", async () => {
    await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: "12345678-9",
      metodoPago: "debito",
      items: [{ productoId: 1, cantidad: 2 }],
    });

    const efectivoRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta_efectivo`,
    );

    expect(Number(efectivoRows[0].count)).toBe(0);
  });

  it("rolls back when cash payment is insufficient", async () => {
    await expect(
      registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: "12345678-9",
        metodoPago: "efectivo",
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

  it.each([
    [{ monto: 1.5, razon: "fracción" }, "monto entero"],
    ["malformado", "monto entero"],
    [{ monto: 100, razon: { texto: "objeto" } }, "razón del descuento"],
  ] as const)(
    "rechaza descuento malformado mediante reglas SQL: %j",
    async (descuento, message) => {
      await expect(
        registerSale(testDb!.db as unknown as DbExecutor, {
          usuarioId: "12345678-9",
          metodoPago: "debito",
          items: [{ productoId: 1, cantidad: 1 }],
          descuento: descuento as never,
        }),
      ).rejects.toThrow(message);
    },
  );

  it.each([1.5, undefined])(
    "rechaza monto recibido no entero o ausente: %j",
    async (montoRecibido) => {
      await expect(
        registerSale(testDb!.db as unknown as DbExecutor, {
          usuarioId: "12345678-9",
          metodoPago: "efectivo",
          montoRecibido,
          items: [{ productoId: 1, cantidad: 1 }],
        }),
      ).rejects.toThrow("monto recibido válido");
    },
  );

  it.each([
    ["inexistente", 999, false],
    ["inactivo", 1, true],
  ])(
    "rechaza un producto %s sin persistir la venta",
    async (_case, productoId, inactive) => {
      if (inactive) {
        await testDb!.db.run(
          sql`UPDATE producto SET producto_estado = 'inactivo' WHERE producto_id = 1`,
        );
      }

      await expect(
        registerSale(testDb!.db as unknown as DbExecutor, {
          usuarioId: "12345678-9",
          metodoPago: "debito",
          items: [{ productoId, cantidad: 1 }],
        }),
      ).rejects.toBeInstanceOf(SaleValidationError);

      const rows = await testDb!.db.all<{ count: number }>(
        sql`SELECT COUNT(*) AS count FROM venta`,
      );
      expect(Number(rows[0].count)).toBe(0);
    },
  );

  it.each([
    ["efectivo", 10_000],
    ["debito", undefined],
  ] as const)(
    "rechaza stock insuficiente con pago %s sin escrituras parciales",
    async (metodoPago, montoRecibido) => {
      await expect(
        registerSale(testDb!.db as unknown as DbExecutor, {
          usuarioId: "12345678-9",
          metodoPago,
          montoRecibido,
          items: [{ productoId: 1, cantidad: 7 }],
        }),
      ).rejects.toBeInstanceOf(SaleBusinessError);

      const rows = await testDb!.db.all<{
        ventas: number;
        detalles: number;
        stock: number;
      }>(sql`
      SELECT
        (SELECT COUNT(*) FROM venta) AS ventas,
        (SELECT COUNT(*) FROM detalle_venta) AS detalles,
        (SELECT SUM(lote_cantidad_actual) FROM lote WHERE producto_id = 1) AS stock
    `);
      expect(Number(rows[0].ventas)).toBe(0);
      expect(Number(rows[0].detalles)).toBe(0);
      expect(Number(rows[0].stock)).toBe(6);
    },
  );

  it.each(["cheque", {}, undefined])(
    "rechaza un método de pago inválido sin delegar el valor al driver: %j",
    async (metodoPago) => {
      await expect(
        registerSale(testDb!.db as unknown as DbExecutor, {
          usuarioId: "12345678-9",
          metodoPago: metodoPago as never,
          items: [{ productoId: 1, cantidad: 1 }],
        }),
      ).rejects.toBeInstanceOf(SaleValidationError);
    },
  );

  it("ignora una caja cerrada anterior y abre la caja del nuevo día", async () => {
    await testDb!.db.run(sql`UPDATE cierre_caja SET cierre_estado = 'cerrado',
      cierre_fecha_hora_fin = '2026-06-12T20:00:00.000Z',
      usuario_cierre_id = '12345678-9'`);

    const receipt = await registerSale(
      testDb!.db as unknown as DbExecutor,
      {
        usuarioId: "12345678-9",
        metodoPago: "credito",
        items: [{ productoId: 1, cantidad: 1 }],
      },
      new Date("2026-06-13T12:00:00.000Z"),
    );

    expect(receipt.total).toBe(1000);

    const openRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM cierre_caja WHERE cierre_estado = 'abierto'`,
    );
    expect(Number(openRows[0].count)).toBe(1);
  });

  it("serializa ventas concurrentes sin stock negativo ni registros parciales", async () => {
    const secondClient = createClient({ url: `file:${testDb!.dbPath}` });
    await secondClient.execute("PRAGMA foreign_keys = ON");
    const secondDb = drizzle(secondClient, { schema });

    try {
      const payload = {
        usuarioId: "12345678-9",
        metodoPago: "debito" as const,
        items: [{ productoId: 1, cantidad: 4 }],
      };
      const results = await Promise.allSettled([
        registerSale(testDb!.db as unknown as DbExecutor, payload),
        registerSale(secondDb as unknown as DbExecutor, payload),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") {
        expect(
          rejected.reason instanceof SaleBusinessError ||
            /busy|locked/i.test(String(rejected.reason)),
        ).toBe(true);
      }

      const stockRows = await testDb!.db.all<{
        stock: number;
        minimum: number;
      }>(sql`
        SELECT SUM(lote_cantidad_actual) AS stock,
          MIN(lote_cantidad_actual) AS minimum
        FROM lote WHERE producto_id = 1
      `);
      const ventaRows = await testDb!.db.all<{ count: number }>(
        sql`SELECT COUNT(*) AS count FROM venta`,
      );
      const detalleRows = await testDb!.db.all<{ count: number }>(
        sql`SELECT COUNT(*) AS count FROM detalle_venta`,
      );

      expect(Number(stockRows[0].stock)).toBe(2);
      expect(Number(stockRows[0].minimum)).toBeGreaterThanOrEqual(0);
      expect(Number(ventaRows[0].count)).toBe(1);
      expect(Number(detalleRows[0].count)).toBe(1);
    } finally {
      secondClient.close();
    }
  });

  it("revierte venta, detalle y stock si falla venta_lote después del descuento", async () => {
    const faultyDb = failWhenWritingVentaLote(
      testDb!.db as unknown as DbExecutor,
    );

    await expect(
      registerSale(faultyDb, {
        usuarioId: "12345678-9",
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 1 }],
      }),
    ).rejects.toThrow("fallo inyectado en venta_lote");

    const counts = await testDb!.db.all<{
      ventas: number;
      detalles: number;
      movimientos: number;
      auditorias: number;
      stock: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM venta) AS ventas,
        (SELECT COUNT(*) FROM detalle_venta) AS detalles,
        (SELECT COUNT(*) FROM venta_lote) AS movimientos,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias,
        (SELECT SUM(lote_cantidad_actual) FROM lote WHERE producto_id = 1) AS stock
    `);

    expect(Number(counts[0].ventas)).toBe(0);
    expect(Number(counts[0].detalles)).toBe(0);
    expect(Number(counts[0].movimientos)).toBe(0);
    expect(Number(counts[0].auditorias)).toBe(0);
    expect(Number(counts[0].stock)).toBe(6);
  });
});

function failWhenWritingVentaLote(database: DbExecutor): DbExecutor {
  return {
    all: (query) => database.all(query),
    run: (query) => database.run(query),
    transaction: (callback) =>
      database.transaction((tx) =>
        callback({
          all: (query) => tx.all(query),
          transaction: (nested) => tx.transaction(nested),
          run: (query) => {
            if (extractSqlText(query).includes("venta_lote")) {
              throw new Error("fallo inyectado en venta_lote");
            }
            return tx.run(query);
          },
        }),
      ),
  };
}

function extractSqlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractSqlText).join(" ");
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return [record.value, record.queryChunks].map(extractSqlText).join(" ");
}

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-sale-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute("PRAGMA foreign_keys = ON");
  await applyMigrations(client);

  return { client, db, dbPath, dir };
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
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const migration = await readFile(join(migrationsDir, file), "utf8");

    await client.executeMultiple(migration);
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
