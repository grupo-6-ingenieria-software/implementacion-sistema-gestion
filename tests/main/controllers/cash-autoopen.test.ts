import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { closeCashRegister } from "../../../src/main/controllers/cash-closing-service";
import {
  getOpenCashRegister,
  registerSale as registerSaleWithActor,
  SaleBusinessError,
  type DbExecutor,
} from "../../../src/main/controllers/sale-service";
import type { SaleRegisterRequest } from "../../../src/shared/sales";

const TEST_SESSION_ID = "00000000-0000-4000-8000-000000000091";

function registerSale(
  database: DbExecutor,
  payload: SaleRegisterRequest & { usuarioId?: string },
  now?: Date,
) {
  const { usuarioId = "12345678-9", ...request } = payload;
  return registerSaleWithActor(
    database,
    request,
    { usuarioId, sesionId: TEST_SESSION_ID, rol: "dueno" },
    now,
  );
}

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();

  await seedWithoutCashRegister(testDb.db as unknown as DbExecutor);
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe("caja autoabrir (#29)", () => {
  it("auto-abre exactamente una caja en una BD sin cierre_caja", async () => {
    await expectOpenCashRegisters(0);

    const opened = await getOpenCashRegister(
      testDb!.db as unknown as DbExecutor,
    );

    expect(opened).not.toBeNull();
    expect(opened?.cierreCajaId).toBeTruthy();
    await expectOpenCashRegisters(1);
  });

  it("permite registrar la primera venta en una BD limpia auto-abriendo caja", async () => {
    await expectOpenCashRegisters(0);

    const receipt = await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: "12345678-9",
      metodoPago: "efectivo",
      montoRecibido: 5000,
      items: [{ productoId: 1, ean13: "7802920000015", cantidad: 3 }],
    });

    expect(receipt.total).toBe(3000);

    const ventaRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta`,
    );
    expect(Number(ventaRows[0].count)).toBe(1);
    await expectOpenCashRegisters(1);
  });

  it("planifica stock antes de abrir caja y conserva el orden normalizado de consumo", async () => {
    const trace: string[] = [];
    const traced = traceDatabase(testDb!.db as unknown as DbExecutor, trace);

    await registerSale(traced, {
      usuarioId: "12345678-9",
      metodoPago: "debito",
      items: [{ productoId: 1, cantidad: 1 }],
    });

    const stockPlan = trace.findIndex(
      (entry) =>
        entry.includes("SUM(lote_cantidad_actual)") &&
        entry.includes("sufficient"),
    );
    const responsible = trace.findIndex(
      (entry) =>
        entry.includes("FROM sesion_usuario") &&
        entry.includes("JOIN trabajador"),
    );
    const product = trace.findIndex((entry) => entry.includes("FROM producto"));
    const category = trace.findIndex((entry) =>
      entry.includes("FROM categoria"),
    );
    const price = trace.findIndex((entry) =>
      entry.includes("FROM historial_precio_producto"),
    );
    const stockSnapshot = trace.findIndex(
      (entry) =>
        entry.includes("FROM lote") && entry.includes("stockDisponible"),
    );
    const openCash = trace.findIndex((entry) =>
      entry.includes("INSERT INTO cierre_caja"),
    );
    const insertSale = trace.findIndex((entry) =>
      entry.includes("INSERT INTO venta ("),
    );
    const updateLot = trace.findIndex((entry) => entry.includes("UPDATE lote"));
    const insertSaleLot = trace.findIndex((entry) =>
      entry.includes("INSERT INTO venta_lote"),
    );

    expect(stockPlan).toBeGreaterThanOrEqual(0);
    expect(responsible).toBeGreaterThanOrEqual(0);
    expect(product).toBeGreaterThan(responsible);
    expect(category).toBeGreaterThan(product);
    expect(price).toBeGreaterThan(category);
    expect(stockSnapshot).toBeGreaterThan(price);
    expect(stockPlan).toBeGreaterThan(stockSnapshot);
    expect(openCash).toBeGreaterThan(stockPlan);
    expect(insertSale).toBeGreaterThan(openCash);
    expect(updateLot).toBeGreaterThan(insertSale);
    expect(insertSaleLot).toBeGreaterThan(updateLot);
  });

  it("no abre caja cuando la planificación SQL detecta stock insuficiente", async () => {
    await expect(
      registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: "12345678-9",
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 99 }],
      }),
    ).rejects.toBeInstanceOf(SaleBusinessError);

    await expectOpenCashRegisters(0);
  });

  it("tras cerrar caja, bloquea nuevas ventas durante el mismo día", async () => {
    await registerSale(testDb!.db as unknown as DbExecutor, {
      usuarioId: "12345678-9",
      metodoPago: "debito",
      items: [{ productoId: 1, cantidad: 1 }],
    });
    const firstOpen = await getOpenCashRegister(
      testDb!.db as unknown as DbExecutor,
    );
    expect(firstOpen).not.toBeNull();

    await closeCashRegister(
      testDb!.db as unknown as DbExecutor,
      { usuarioId: "12345678-9", confirmacion: true },
      new Date(),
    );
    await expectOpenCashRegisters(0);

    await expect(
      registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: "12345678-9",
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 1 }],
      }),
    ).rejects.toBeInstanceOf(SaleBusinessError);

    const secondOpen = await getOpenCashRegister(
      testDb!.db as unknown as DbExecutor,
    );
    expect(secondOpen).toBeNull();
    await expectOpenCashRegisters(0);

    const totalCajas = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM cierre_caja`,
    );
    expect(Number(totalCajas[0].count)).toBe(1);
  });

  it("no crea cajas duplicadas al invocar getOpenCashRegister repetidamente", async () => {
    const first = await getOpenCashRegister(
      testDb!.db as unknown as DbExecutor,
    );
    const second = await getOpenCashRegister(
      testDb!.db as unknown as DbExecutor,
    );
    const third = await getOpenCashRegister(
      testDb!.db as unknown as DbExecutor,
    );

    expect(first?.cierreCajaId).toBeTruthy();
    expect(second?.cierreCajaId).toBe(first?.cierreCajaId);
    expect(third?.cierreCajaId).toBe(first?.cierreCajaId);

    await expectOpenCashRegisters(1);
    const totalCajas = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM cierre_caja`,
    );
    expect(Number(totalCajas[0].count)).toBe(1);
  });

  it("prioriza una caja cerrada ante una apertura heredada posterior del mismo día", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000).toISOString();
    const later = now.toISOString();

    await testDb!.db.run(sql`
      INSERT INTO cierre_caja (
        cierre_caja_id,
        cierre_fecha_hora_inicio,
        cierre_fecha_hora_fin,
        cierre_estado,
        usuario_cierre_id
      ) VALUES (
        ${randomUUID()}, ${earlier}, ${later}, 'cerrado', '12345678-9'
      )
    `);
    await testDb!.db.run(sql`
      INSERT INTO cierre_caja (
        cierre_caja_id,
        cierre_fecha_hora_inicio,
        cierre_estado
      ) VALUES (${randomUUID()}, ${later}, 'abierto')
    `);

    await expect(
      registerSale(
        testDb!.db as unknown as DbExecutor,
        {
          usuarioId: "12345678-9",
          metodoPago: "debito",
          items: [{ productoId: 1, cantidad: 1 }],
        },
        now,
      ),
    ).rejects.toBeInstanceOf(SaleBusinessError);

    const ventaRows = await testDb!.db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM venta`,
    );
    expect(Number(ventaRows[0].count)).toBe(0);
  });
});

async function expectOpenCashRegisters(expected: number): Promise<void> {
  const rows = await testDb!.db.all<{ count: number }>(
    sql`SELECT COUNT(*) AS count FROM cierre_caja WHERE cierre_estado = 'abierto'`,
  );
  expect(Number(rows[0].count)).toBe(expected);
}

function traceDatabase(database: DbExecutor, trace: string[]): DbExecutor {
  return {
    all: (query) => {
      trace.push(extractSqlText(query));
      return database.all(query);
    },
    run: (query) => {
      trace.push(extractSqlText(query));
      return database.run(query);
    },
    transaction: (callback) =>
      database.transaction((tx) => callback(traceDatabase(tx, trace))),
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
  const dir = await mkdtemp(join(tmpdir(), "huascar-autoopen-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute("PRAGMA foreign_keys = ON");
  await applyMigrations(client);

  return { client, db, dir };
}

async function seedWithoutCashRegister(db: DbExecutor): Promise<void> {
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
    INSERT INTO sesion_usuario (
      sesion_usuario_id,
      sesion_fecha_hora_inicio,
      sesion_fecha_hora_ultimo_acceso,
      usuario_id
    )
    VALUES (
      ${TEST_SESSION_ID},
      '2026-01-01T00:00:00.000Z',
      '2099-01-01T00:00:00.000Z',
      '12345678-9'
    )
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
      ('00000000-0000-4000-8000-000000000101', 10, 10, 700, '2026-01-01T00:00:00.000Z', 1, 0, 1)
  `);

  await db.run(sql`
    INSERT INTO lote_perecible (
      lote_id,
      lote_perecible_fecha_vencimiento
    )
    VALUES
      ('00000000-0000-4000-8000-000000000101', '2026-08-01')
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
