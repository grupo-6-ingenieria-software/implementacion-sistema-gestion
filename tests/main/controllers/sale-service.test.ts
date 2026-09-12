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
  registerSale as registerSaleWithActor,
  SaleBusinessError,
  SaleValidationError,
  validateSaleCart,
  type DbExecutor,
} from "../../../src/main/controllers/sale-service";
import type { SaleRegisterRequest } from "../../../src/shared/sales";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";

const TEST_SESSION_ID = "00000000-0000-4000-8000-000000000091";

type TestSalePayload = SaleRegisterRequest & { usuarioId?: string };

function registerSale(
  database: DbExecutor,
  payload: TestSalePayload,
  now?: Date,
) {
  if (!payload) {
    return registerSaleWithActor(
      database,
      payload as never,
      {
        usuarioId: "12345678-9",
        sesionId: TEST_SESSION_ID,
        rol: "dueno",
      },
      now,
    );
  }
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
  it.each(["dueno", "trabajador"] as const)(
    "CU37 preserves discounted registration for %s",
    async (rol) => {
      await testDb!.db.run(
        sql`UPDATE usuario SET usuario_rol = ${rol} WHERE usuario_id = '12345678-9'`,
      );
      const result = await registerSaleWithActor(
        testDb!.db as unknown as DbExecutor,
        {
          metodoPago: "debito",
          items: [{ productoId: 1, cantidad: 1 }],
          descuento: { monto: 100, razon: "Promoción" },
        },
        {
          usuarioId: "12345678-9",
          sesionId: TEST_SESSION_ID,
          rol,
        },
      );
      expect(result.total).toBe(900);
      expect(result.responsable.rol).toBe(rol);
    },
  );

  it("persists the signed session role and current worker name as an immutable snapshot", async () => {
    await testDb!.db.run(sql`
      UPDATE usuario SET usuario_rol = 'trabajador'
      WHERE usuario_id = '12345678-9'
    `);

    const receipt = await registerSaleWithActor(
      testDb!.db as unknown as DbExecutor,
      {
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 1 }],
      },
      {
        usuarioId: "12345678-9",
        sesionId: TEST_SESSION_ID,
        rol: "dueno",
      },
    );

    expect(receipt.responsable).toEqual({
      usuarioId: "12345678-9",
      nombre: "Maria Huascar",
      rol: "dueno",
    });

    await testDb!.db.run(sql`
      UPDATE trabajador
      SET trabajador_nombre = 'Nombre', trabajador_apellido = 'Nuevo'
      WHERE trabajador_id = 1
    `);
    const stored = await testDb!.db.all(sql`
      SELECT usuario_cajero_id AS usuarioId,
        venta_responsable_nombre AS nombre,
        venta_responsable_rol AS rol
      FROM venta
    `);
    expect(stored).toEqual([
      { usuarioId: "12345678-9", nombre: "Maria Huascar", rol: "dueno" },
    ]);
  });

  it.each(["cerrada", "ajena", "expirada", "trabajador-inactivo"] as const)(
    "rejects %s identity/session state without sale-side writes",
    async (scenario) => {
      if (scenario === "cerrada") {
        await testDb!.db.run(sql`
          UPDATE sesion_usuario
          SET sesion_fecha_hora_cierre = '2026-06-12T17:00:00.000Z',
              sesion_motivo_cierre = 'manual'
          WHERE sesion_usuario_id = ${TEST_SESSION_ID}
        `);
      } else if (scenario === "expirada") {
        await testDb!.db.run(sql`
          UPDATE sesion_usuario
          SET sesion_fecha_hora_ultimo_acceso = '2026-06-12T17:29:59.000Z'
          WHERE sesion_usuario_id = ${TEST_SESSION_ID}
        `);
      } else if (scenario === "trabajador-inactivo") {
        await testDb!.db.run(sql`
          UPDATE trabajador SET trabajador_estado = 'inactivo'
          WHERE trabajador_id = 1
        `);
      }

      await expect(
        registerSaleWithActor(
          testDb!.db as unknown as DbExecutor,
          {
            metodoPago: "debito",
            items: [{ productoId: 1, cantidad: 1 }],
          },
          {
            usuarioId:
              scenario === "ajena" ? "usuario-ajeno" : "12345678-9",
            sesionId: TEST_SESSION_ID,
            rol: "dueno",
          },
          new Date("2026-06-12T18:00:00.000Z"),
        ),
      ).rejects.toBeInstanceOf(AccessDeniedError);

      const rows = await testDb!.db.all(sql`
        SELECT
          (SELECT COUNT(*) FROM venta) AS ventas,
          (SELECT COUNT(*) FROM detalle_venta) AS detalles,
          (SELECT COUNT(*) FROM venta_lote) AS consumos,
          (SELECT COUNT(*) FROM log_auditoria) AS auditorias,
          (SELECT SUM(lote_cantidad_actual) FROM lote) AS stock,
          (SELECT COUNT(*) FROM cierre_caja) AS cajas
      `);
      expect(rows).toEqual([
        {
          ventas: 0,
          detalles: 0,
          consumos: 0,
          auditorias: 0,
          stock: 6,
          cajas: 1,
        },
      ]);
    },
  );
  it.each([
    [500, "  Promoción  ", "monto", 500, "Promoción", 2500],
    [0, "", "ninguno", null, null, 3000],
    [0, "Razón descartada", "ninguno", null, null, 3000],
    [3000, "Cortesía", "monto", 3000, "Cortesía", 0],
  ] as const)(
    "CU37 persists discount %s and calculates authoritative totals",
    async (monto, razon, tipo, valor, storedReason, total) => {
      const receipt = await registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: "12345678-9",
        metodoPago: "efectivo",
        montoRecibido: 3000,
        items: [{ productoId: 1, cantidad: 3 }],
        descuento: { monto, razon },
      });
      expect(receipt).toMatchObject({
        subtotal: 3000,
        total,
        vuelto: 3000 - total,
        descuento: { tipo, valor: monto, razon: storedReason ?? undefined },
      });
      const rows = await testDb!.db.all(
        sql`SELECT venta_descuento_tipo AS tipo, venta_descuento_valor AS valor, venta_descuento_razon AS razon FROM venta`,
      );
      expect(rows).toEqual([{ tipo, valor, razon: storedReason }]);
    },
  );

  it.each([
    { monto: 3001, razon: "Rango" },
    { monto: 500, razon: "" },
    { monto: 500, razon: " \t\n " },
    { monto: -1, razon: "Negativo" },
    { monto: NaN, razon: "Inválido" },
    { monto: Infinity, razon: "Inválido" },
    { monto: Number.MAX_SAFE_INTEGER + 1, razon: "Inválido" },
    { monto: "500", razon: "Tipo incorrecto" },
    { monto: "1.500", razon: "Texto IPC" },
  ])("CU37 rejects invalid discount %j without writes", async (descuento) => {
    await expect(
      registerSale(testDb!.db as unknown as DbExecutor, {
        usuarioId: "12345678-9",
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 3 }],
        descuento: descuento as never,
      }),
    ).rejects.toBeInstanceOf(SaleValidationError);
    const rows = await testDb!.db.all(sql`SELECT
      (SELECT COUNT(*) FROM venta) AS ventas, (SELECT COUNT(*) FROM detalle_venta) AS detalles,
      (SELECT COUNT(*) FROM venta_efectivo) AS efectivo, (SELECT COUNT(*) FROM venta_lote) AS consumos,
      (SELECT COUNT(*) FROM log_auditoria) AS auditorias, (SELECT SUM(lote_cantidad_actual) FROM lote) AS stock,
      (SELECT COUNT(*) FROM cierre_caja) AS cajas`);
    expect(rows).toEqual([
      {
        ventas: 0,
        detalles: 0,
        efectivo: 0,
        consumos: 0,
        auditorias: 0,
        stock: 6,
        cajas: 1,
      },
    ]);
  });

  it("CU37 revalidates against a price changed after cart preview", async () => {
    const database = testDb!.db as unknown as DbExecutor;
    expect(
      (
        await validateSaleCart(database, {
          items: [{ productoId: 1, cantidad: 1 }],
        })
      ).subtotal,
    ).toBe(1000);
    await testDb!.db.run(
      sql`UPDATE historial_precio_producto SET historial_precio_venta = 400 WHERE producto_id = 1`,
    );
    await expect(
      registerSale(database, {
        usuarioId: "12345678-9",
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 1 }],
        descuento: { monto: 500, razon: "Promoción" },
      }),
    ).rejects.toThrow("mayor al subtotal");
    expect(
      await testDb!.db.all(sql`SELECT COUNT(*) AS cantidad FROM venta`),
    ).toEqual([{ cantidad: 0 }]);
  });
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
    const transactionAll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          usuarioId: "12345678-9",
          sesionFechaHoraCierre: null,
          sesionVigente: 1,
          trabajadorEstado: "activo",
          nombre: "Maria Huascar",
        },
      ])
      .mockResolvedValueOnce([
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
    expect(transactionAll).toHaveBeenCalledTimes(2);
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

  it.each([
    "INSERT INTO venta (",
    "INSERT INTO venta_efectivo",
    "INSERT INTO detalle_venta",
    "UPDATE lote",
    "INSERT INTO venta_lote",
    "INSERT INTO log_auditoria",
  ])("rolls back every sale-side write when %s fails", async (sqlFragment) => {
    const faultyDb = failWhenWriting(
      testDb!.db as unknown as DbExecutor,
      sqlFragment,
    );

    await expect(
      registerSale(faultyDb, {
        usuarioId: "12345678-9",
        metodoPago: "efectivo",
        montoRecibido: 1000,
        items: [{ productoId: 1, cantidad: 1 }],
      }),
    ).rejects.toThrow(`fallo inyectado en ${sqlFragment}`);

    const counts = await testDb!.db.all<{
      ventas: number;
      detalles: number;
      efectivo: number;
      movimientos: number;
      auditorias: number;
      stock: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM venta) AS ventas,
        (SELECT COUNT(*) FROM detalle_venta) AS detalles,
        (SELECT COUNT(*) FROM venta_efectivo) AS efectivo,
        (SELECT COUNT(*) FROM venta_lote) AS movimientos,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias,
        (SELECT SUM(lote_cantidad_actual) FROM lote WHERE producto_id = 1) AS stock
    `);

    expect(Number(counts[0].ventas)).toBe(0);
    expect(Number(counts[0].detalles)).toBe(0);
    expect(Number(counts[0].efectivo)).toBe(0);
    expect(Number(counts[0].movimientos)).toBe(0);
    expect(Number(counts[0].auditorias)).toBe(0);
    expect(Number(counts[0].stock)).toBe(6);
  });

  it("rolls back an automatically opened cash register when a later write fails", async () => {
    await testDb!.db.run(sql`DELETE FROM cierre_caja`);
    const faultyDb = failWhenWriting(
      testDb!.db as unknown as DbExecutor,
      "INSERT INTO log_auditoria",
    );

    await expect(
      registerSale(faultyDb, {
        usuarioId: "12345678-9",
        metodoPago: "debito",
        items: [{ productoId: 1, cantidad: 1 }],
      }),
    ).rejects.toThrow("fallo inyectado en INSERT INTO log_auditoria");

    expect(
      await testDb!.db.all(sql`
        SELECT (SELECT COUNT(*) FROM cierre_caja) AS cajas,
          (SELECT COUNT(*) FROM venta) AS ventas,
          (SELECT SUM(lote_cantidad_actual) FROM lote) AS stock
      `),
    ).toEqual([{ cajas: 0, ventas: 0, stock: 6 }]);
  });
});

function failWhenWriting(
  database: DbExecutor,
  sqlFragment: string,
): DbExecutor {
  return {
    all: (query) => database.all(query),
    run: (query) => database.run(query),
    transaction: (callback) =>
      database.transaction((tx) =>
        callback({
          all: (query) => tx.all(query),
          transaction: (nested) => tx.transaction(nested),
          run: (query) => {
            if (extractSqlText(query).includes(sqlFragment)) {
              throw new Error(`fallo inyectado en ${sqlFragment}`);
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
