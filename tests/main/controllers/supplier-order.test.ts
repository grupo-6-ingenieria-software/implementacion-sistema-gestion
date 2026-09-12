import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { registerSupplierOrderWithExecutor } from "../../../src/main/controllers/supplier-order";
import {
  SupplierOrderDomainError,
  cancelSupplierOrderWithExecutor,
  closeSupplierOrderBalanceWithExecutor,
  confirmSupplierOrderReceptionWithExecutor,
} from "../../../src/main/controllers/supplier-order-reception";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
let testDb: TestDatabase | undefined;

beforeEach(async () => {
  testDb = await createTestDatabase();
  await seedFixture(testDb.db);
});

afterEach(async () => {
  if (!testDb) return;
  testDb.client.close();
  await removeTempDir(testDb.dir);
  testDb = undefined;
});

describe("CU17 supplier order registration", () => {
  it("registers a valid pending order with provider, product and trusted responsible", async () => {
    const result = await createOrder(10);
    const rows = await testDb!.db.all<{
      cantidad: number;
      estado: string;
      proveedorId: number;
      usuarioId: string;
    }>(sql`
      SELECT
        pp.pedido_proveedor_estado AS estado,
        pp.proveedor_id AS proveedorId,
        pp.usuario_emisor_id AS usuarioId,
        dp.cantidad_solicitada AS cantidad
      FROM pedido_proveedor pp
      INNER JOIN detalle_pedido dp
        ON dp.pedido_proveedor_id = pp.pedido_proveedor_id
      WHERE pp.pedido_proveedor_id = ${result.pedidoId}
    `);

    expect(result.estado).toBe("pendiente");
    expect(rows).toEqual([
      {
        cantidad: 10,
        estado: "pendiente",
        proveedorId: 1,
        usuarioId: "12345678-9",
      },
    ]);
  });

  it("rejects a duplicated product without creating a partial order", async () => {
    await expect(
      testDb!.db.transaction((tx) =>
        registerSupplierOrderWithExecutor(tx, schema, {
          proveedorId: 1,
          usuarioId: "12345678-9",
          lineas: [
            { ean13: "7802920000015", cantidad: 10 },
            { ean13: "7802920000015", cantidad: 5 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ reason: "validation" });
    expect(await count("pedido_proveedor")).toBe(0);
  });

  it.each([0, -1, 1.5])(
    "rejects invalid requested quantity %s",
    async (cantidad) => {
      await expect(
        testDb!.db.transaction((tx) =>
          registerSupplierOrderWithExecutor(tx, schema, {
            proveedorId: 1,
            usuarioId: "12345678-9",
            lineas: [{ ean13: "7802920000015", cantidad }],
          }),
        ),
      ).rejects.toMatchObject({ reason: "validation" });
      expect(await count("pedido_proveedor")).toBe(0);
    },
  );
});

describe("CU18 successive and atomic receptions", () => {
  it("keeps a partial delivery and then completes the order with two lots", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);

    const first = await receive(order.pedidoId, detailId, 4);
    expect(first.estado).toBe("parcial");
    await expectOrderSnapshot(order.pedidoId, {
      estado: "parcial",
      lotes: 1,
      recepciones: 1,
      recibido: 4,
      stock: 4,
    });

    const second = await receive(order.pedidoId, detailId, 6);
    expect(second.estado).toBe("recibido");
    await expectOrderSnapshot(order.pedidoId, {
      estado: "recibido",
      lotes: 2,
      recepciones: 2,
      recibido: 10,
      stock: 10,
    });
  });

  it("returns the previous result for the same operation without duplicating stock", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);
    const operationId = randomUUID();
    const first = await receive(order.pedidoId, detailId, 4, operationId);
    const retry = await receive(order.pedidoId, detailId, 4, operationId);

    expect(first.idempotente).toBe(false);
    expect(retry).toMatchObject({
      idempotente: true,
      recepcionId: first.recepcionId,
      operacionId: operationId,
    });
    await expectOrderSnapshot(order.pedidoId, {
      estado: "parcial",
      lotes: 1,
      recepciones: 1,
      recibido: 4,
      stock: 4,
    });
  });

  it("rejects an amount over the current balance without changes", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);
    await receive(order.pedidoId, detailId, 4);

    await expect(receive(order.pedidoId, detailId, 7)).rejects.toMatchObject({
      reason: "validation",
    });
    await expectOrderSnapshot(order.pedidoId, {
      estado: "parcial",
      lotes: 1,
      recepciones: 1,
      recibido: 4,
      stock: 4,
    });
  });

  it("rejects an empty delivery", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);

    await expect(receive(order.pedidoId, detailId, 0)).rejects.toMatchObject({
      reason: "validation",
    });
    await expectOrderSnapshot(order.pedidoId, {
      estado: "pendiente",
      lotes: 0,
      recepciones: 0,
      recibido: 0,
      stock: 0,
    });
  });

  it("rejects an invalid calendar expiration date without changes", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);

    await expect(
      testDb!.db.transaction((tx) =>
        confirmSupplierOrderReceptionWithExecutor(tx, schema, {
          pedidoId: order.pedidoId,
          operacionId: randomUUID(),
          usuarioId: "12345678-9",
          lineas: [
            {
              detallePedidoId: detailId,
              cantidad: 4,
              precioCosto: 700,
              fechaVencimiento: "2099-02-31",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ reason: "validation" });
    await expectOrderSnapshot(order.pedidoId, {
      estado: "pendiente",
      lotes: 0,
      recepciones: 0,
      recibido: 0,
      stock: 0,
    });
  });

  it("rolls back receipt, lot and accumulated quantity when a later write fails", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);
    await testDb!.client.executeMultiple(`
      CREATE TRIGGER fail_receipt_detail
      BEFORE INSERT ON detalle_recepcion
      BEGIN
        SELECT RAISE(ABORT, 'controlled receipt failure');
      END;
    `);

    await expect(receive(order.pedidoId, detailId, 4)).rejects.toThrow(
      /detalle_recepcion/,
    );
    await expectOrderSnapshot(order.pedidoId, {
      estado: "pendiente",
      lotes: 0,
      recepciones: 0,
      recibido: 0,
      stock: 0,
    });
  });
});

describe("CU18b order cancellation and balance closing", () => {
  it("cancels a pending order without lots or stock changes", async () => {
    const order = await createOrder(10);
    const result = await testDb!.db.transaction((tx) =>
      cancelSupplierOrderWithExecutor(tx, schema, {
        pedidoId: order.pedidoId,
        confirmacion: true,
        usuarioId: "12345678-9",
      }),
    );

    expect(result.estado).toBe("cancelado");
    await expectOrderSnapshot(order.pedidoId, {
      estado: "cancelado",
      lotes: 0,
      recepciones: 0,
      recibido: 0,
      stock: 0,
    });
  });

  it("rejects cancellation after a partial reception", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);
    await receive(order.pedidoId, detailId, 4);

    await expect(
      testDb!.db.transaction((tx) =>
        cancelSupplierOrderWithExecutor(tx, schema, {
          pedidoId: order.pedidoId,
          confirmacion: true,
          usuarioId: "12345678-9",
        }),
      ),
    ).rejects.toMatchObject({ reason: "state" });
    await expectOrderSnapshot(order.pedidoId, {
      estado: "parcial",
      lotes: 1,
      recepciones: 1,
      recibido: 4,
      stock: 4,
    });
  });

  it("closes a partial balance while preserving delivery, lot and missing quantity", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);
    await receive(order.pedidoId, detailId, 4);
    const result = await testDb!.db.transaction((tx) =>
      closeSupplierOrderBalanceWithExecutor(tx, schema, {
        pedidoId: order.pedidoId,
        confirmacion: true,
        motivo: "Proveedor informó quiebre de stock",
        usuarioId: "12345678-9",
      }),
    );

    expect(result.estado).toBe("parcial_cerrado");
    await expectOrderSnapshot(order.pedidoId, {
      estado: "parcial_cerrado",
      lotes: 1,
      recepciones: 1,
      recibido: 4,
      stock: 4,
    });
    const history = await testDb!.db.all<{ nota: string }>(sql`
      SELECT historial_ap_nota AS nota
      FROM historial_auditoria_pedido
      WHERE pedido_proveedor_id = ${order.pedidoId}
        AND historial_ap_tipo_evento = 'cierre_saldo'
    `);
    expect(history[0]?.nota).toContain("Proveedor informó quiebre de stock");
    expect(history[0]?.nota).toContain("Faltante conservado: 6");
  });

  it("rejects closing a balance without a reason", async () => {
    const order = await createOrder(10);
    const detailId = await getDetailId(order.pedidoId);
    await receive(order.pedidoId, detailId, 4);

    await expect(
      testDb!.db.transaction((tx) =>
        closeSupplierOrderBalanceWithExecutor(tx, schema, {
          pedidoId: order.pedidoId,
          confirmacion: true,
          motivo: "   ",
          usuarioId: "12345678-9",
        }),
      ),
    ).rejects.toMatchObject({ reason: "validation" });
    await expectOrderSnapshot(order.pedidoId, {
      estado: "parcial",
      lotes: 1,
      recepciones: 1,
      recibido: 4,
      stock: 4,
    });
  });

  it("rejects new receipts for received, cancelled and partial-closed orders", async () => {
    const received = await createOrder(10);
    const receivedLine = await getDetailId(received.pedidoId);
    await receive(received.pedidoId, receivedLine, 10);

    const cancelled = await createOrder(10);
    const cancelledLine = await getDetailId(cancelled.pedidoId);
    await testDb!.db.transaction((tx) =>
      cancelSupplierOrderWithExecutor(tx, schema, {
        pedidoId: cancelled.pedidoId,
        confirmacion: true,
        usuarioId: "12345678-9",
      }),
    );

    const closed = await createOrder(10);
    const closedLine = await getDetailId(closed.pedidoId);
    await receive(closed.pedidoId, closedLine, 4);
    await testDb!.db.transaction((tx) =>
      closeSupplierOrderBalanceWithExecutor(tx, schema, {
        pedidoId: closed.pedidoId,
        confirmacion: true,
        motivo: "Saldo no entregable",
        usuarioId: "12345678-9",
      }),
    );

    for (const [pedidoId, detailId] of [
      [received.pedidoId, receivedLine],
      [cancelled.pedidoId, cancelledLine],
      [closed.pedidoId, closedLine],
    ]) {
      await expect(receive(pedidoId, detailId, 1)).rejects.toMatchObject({
        reason: "state",
      } satisfies Partial<SupplierOrderDomainError>);
    }
  });
});

async function createOrder(cantidad: number) {
  return testDb!.db.transaction((tx) =>
    registerSupplierOrderWithExecutor(tx, schema, {
      proveedorId: 1,
      usuarioId: "12345678-9",
      lineas: [{ ean13: "7802920000015", cantidad }],
    }),
  );
}

async function getDetailId(pedidoId: string): Promise<string> {
  const rows = await testDb!.db.all<{ id: string }>(sql`
    SELECT detalle_pedido_id AS id
    FROM detalle_pedido
    WHERE pedido_proveedor_id = ${pedidoId}
  `);
  return rows[0].id;
}

async function receive(
  pedidoId: string,
  detallePedidoId: string,
  cantidad: number,
  operacionId = randomUUID(),
) {
  return testDb!.db.transaction((tx) =>
    confirmSupplierOrderReceptionWithExecutor(tx, schema, {
      pedidoId,
      operacionId,
      usuarioId: "12345678-9",
      lineas: [
        {
          detallePedidoId,
          cantidad,
          precioCosto: cantidad > 0 ? 700 : undefined,
          fechaVencimiento: cantidad > 0 ? "2099-01-01" : undefined,
        },
      ],
    }),
  );
}

async function expectOrderSnapshot(
  pedidoId: string,
  expected: {
    estado: string;
    lotes: number;
    recepciones: number;
    recibido: number;
    stock: number;
  },
): Promise<void> {
  const rows = await testDb!.db.all<{
    estado: string;
    lotes: number;
    recepciones: number;
    recibido: number;
    stock: number;
  }>(sql`
    SELECT
      pp.pedido_proveedor_estado AS estado,
      (SELECT COUNT(*) FROM recepcion_pedido rp
        WHERE rp.pedido_proveedor_id = pp.pedido_proveedor_id) AS recepciones,
      (SELECT COUNT(*) FROM lote l
        WHERE l.pedido_proveedor_id = pp.pedido_proveedor_id) AS lotes,
      (SELECT COALESCE(SUM(dp.cantidad_recibida), 0) FROM detalle_pedido dp
        WHERE dp.pedido_proveedor_id = pp.pedido_proveedor_id) AS recibido,
      (SELECT COALESCE(SUM(l.lote_cantidad_actual), 0) FROM lote l
        WHERE l.pedido_proveedor_id = pp.pedido_proveedor_id) AS stock
    FROM pedido_proveedor pp
    WHERE pp.pedido_proveedor_id = ${pedidoId}
  `);
  expect(rows[0]).toEqual(expected);
}

async function count(table: "pedido_proveedor"): Promise<number> {
  const rows = await testDb!.db.all<{ total: number }>(
    sql.raw(`SELECT COUNT(*) AS total FROM ${table}`),
  );
  return Number(rows[0]?.total ?? 0);
}

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-supplier-order-"));
  const client = createClient({
    url: `file:${join(dir, "test.db").replace(/\\/g, "/")}`,
  });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  for (const file of (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await client.executeMultiple(
      await readFile(join(migrationsDir, file), "utf8"),
    );
  }
  return { client, db, dir };
}

async function seedFixture(db: TestDatabase["db"]): Promise<void> {
  await db.run(sql`
    INSERT INTO trabajador
      (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
       trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES
      (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo'),
      (2, '98765432-1', 'Pedro', 'Trabajador', '912345678', '2024-02-01', 'activo')
  `);
  await db.run(sql`
    INSERT INTO usuario
      (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES
      ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1),
      ('98765432-1', 'trabajador', '2026-01-01T00:00:00.000Z', 2)
  `);
  await db.run(sql`
    INSERT INTO categoria
      (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Lacteos', 1)
  `);
  await db.run(sql`
    INSERT INTO producto
      (producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
       producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id)
    VALUES
      (1, '7802920000015', 'Leche', 1000, 2, 'activo', '2026-01-01', 1),
      (2, '7802920000022', 'Yogur', 900, 2, 'inactivo', '2026-01-01', 1)
  `);
  await db.run(sql`
    INSERT INTO proveedor
      (proveedor_id, proveedor_rut, proveedor_nombre_razon_social,
       proveedor_nombre_contacto, proveedor_telefono, proveedor_correo_electronico)
    VALUES
      (1, '76543210-1', 'Distribuidora Central S.A.', 'Juan Perez',
       '912345678', 'ventas@distribuidora.cl')
  `);
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
