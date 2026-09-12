import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  loadSaleDetail,
  searchSalesHistory,
} from "../../../src/main/controllers/sales-history";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const currentOpenId = "00000000-0000-4000-8000-000000000411";
const currentClosedId = "00000000-0000-4000-8000-000000000412";
const previousAnnulledId = "00000000-0000-4000-8000-000000000413";
const now = new Date("2026-06-12T18:00:00.000Z");
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

describe("CU41 sales history integration", () => {
  it("lists a Chilean range with historical totals, separated summary and eligibility", async () => {
    const result = await searchSalesHistory(
      testDb!.db,
      {
        criterio: "rango",
        fechaInicio: "2026-06-11",
        fechaTermino: "2026-06-12",
      },
      now,
    );

    expect(result.ventas.map((sale) => sale.ventaId)).toEqual([
      currentOpenId,
      currentClosedId,
      previousAnnulledId,
    ]);
    expect(result.ventas).toEqual([
      expect.objectContaining({
        ventaId: currentOpenId,
        total: 2500,
        metodoPago: "efectivo",
        estado: "confirmada",
        puedeAnular: true,
      }),
      expect.objectContaining({
        ventaId: currentClosedId,
        total: 2000,
        metodoPago: "debito",
        estado: "confirmada",
        puedeAnular: false,
      }),
      expect.objectContaining({
        ventaId: previousAnnulledId,
        total: 1800,
        estado: "anulada",
        puedeAnular: false,
      }),
    ]);
    expect(result.resumen).toEqual({
      ventasVigentes: 2,
      montoVigente: 4500,
      ventasAnuladas: 1,
    });
  });

  it("finds an annulled sale by number and preserves its historical detail", async () => {
    const search = await searchSalesHistory(
      testDb!.db,
      { criterio: "numero", ventaId: previousAnnulledId.toUpperCase() },
      now,
    );
    expect(search).toMatchObject({
      ventas: [{ ventaId: previousAnnulledId, estado: "anulada", total: 1800 }],
      resumen: { ventasVigentes: 0, montoVigente: 0, ventasAnuladas: 1 },
    });

    await expect(
      loadSaleDetail(testDb!.db, { ventaId: previousAnnulledId }),
    ).resolves.toMatchObject({
      estado: "anulada",
      productos: [
        {
          nombre: "Pan histórico",
          cantidad: 2,
          precioUnitario: 1000,
          subtotal: 2000,
        },
      ],
      descuento: { tipo: "porcentaje", valor: 10, razon: "Cliente frecuente" },
      subtotal: 2000,
      total: 1800,
      pago: { metodo: "efectivo", montoRecibido: 2000, vuelto: 200 },
    });
  });

  it("represents fixed discounts and electronic payments without cash fields", async () => {
    await expect(
      loadSaleDetail(testDb!.db, { ventaId: currentOpenId }),
    ).resolves.toMatchObject({
      descuento: { tipo: "monto", valor: 500, razon: "Promoción" },
      subtotal: 3000,
      total: 2500,
      pago: { metodo: "efectivo", montoRecibido: 3000, vuelto: 500 },
    });

    const electronic = await loadSaleDetail(testDb!.db, {
      ventaId: currentClosedId,
    });
    expect(electronic.pago).toEqual({ metodo: "debito" });
    expect(electronic.descuento).toEqual({ tipo: "ninguno", valor: 0 });
  });

  it("returns a successful empty response", async () => {
    await expect(
      searchSalesHistory(
        testDb!.db,
        { criterio: "numero", ventaId: "00000000-0000-4000-8000-000000000499" },
        now,
      ),
    ).resolves.toEqual({
      ventas: [],
      resumen: { ventasVigentes: 0, montoVigente: 0, ventasAnuladas: 0 },
    });
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-cu41-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });

  await client.execute("PRAGMA foreign_keys = ON");
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await client.executeMultiple(
      await readFile(join(migrationsDir, file), "utf8"),
    );
  }
  await client.executeMultiple(
    await readFile(join(process.cwd(), "src/db/triggers.sql"), "utf8"),
  );

  return { client, db, dir };
}

async function seedFixture(database: DbExecutor): Promise<void> {
  await database.run(sql`
    INSERT INTO trabajador (
      trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
      trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado
    ) VALUES (1, '12345678-9', 'Ana', 'Prueba', '987654321', '2024-01-01', 'activo')
  `);
  await database.run(sql`
    INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1)
  `);
  await database.run(sql`
    INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Abarrotes', 0)
  `);
  await database.run(sql`
    INSERT INTO producto (
      producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
      producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id
    ) VALUES (1, '7802920000015', 'Pan histórico', 9999, 1, 'activo',
      '2026-01-01T00:00:00.000Z', 1)
  `);
  await database.run(sql`
    INSERT INTO historial_precio_producto (
      historial_precio_producto_id, historial_precio_costo,
      historial_precio_venta, historial_fecha_hora_vigencia_desde, producto_id
    ) VALUES ('00000000-0000-4000-8000-000000000301', 700, 1000,
      '2026-01-01T00:00:00.000Z', 1)
  `);
  await database.run(sql`
    INSERT INTO cierre_caja (
      cierre_caja_id, cierre_fecha_hora_inicio, cierre_estado
    ) VALUES
      ('00000000-0000-4000-8000-000000000201', '2026-06-12T08:00:00.000Z', 'abierto'),
      ('00000000-0000-4000-8000-000000000202', '2026-06-11T08:00:00.000Z', 'abierto')
  `);
  await database.run(sql`
    INSERT INTO venta (
      venta_id, venta_fecha_hora, venta_descuento_tipo, venta_descuento_valor,
      venta_descuento_razon, venta_metodo_pago, venta_estado,
      es_venta_efectivo, es_venta_electronica, usuario_cajero_id, cierre_caja_id
    ) VALUES
      (${currentOpenId}, '2026-06-12T17:00:00.000Z', 'monto', 500, 'Promoción',
       'efectivo', 'completada', 1, 0, '12345678-9',
       '00000000-0000-4000-8000-000000000201'),
      (${currentClosedId}, '2026-06-12T16:00:00.000Z', 'ninguno', NULL, NULL,
       'debito', 'completada', 0, 1, '12345678-9',
       '00000000-0000-4000-8000-000000000202'),
      (${previousAnnulledId}, '2026-06-11T15:00:00.000Z', 'porcentaje', 10,
       'Cliente frecuente', 'efectivo', 'completada', 1, 0, '12345678-9',
       '00000000-0000-4000-8000-000000000202')
  `);
  await database.run(sql`
    UPDATE cierre_caja
    SET cierre_estado = 'cerrado',
        cierre_fecha_hora_fin = '2026-06-12T02:00:00.000Z',
        usuario_cierre_id = '12345678-9'
    WHERE cierre_caja_id = '00000000-0000-4000-8000-000000000202'
  `);
  await database.run(sql`
    INSERT INTO detalle_venta (
      detalle_venta_id, venta_id, producto_id, detalle_venta_cantidad,
      historial_precio_producto_id
    ) VALUES
      ('00000000-0000-4000-8000-000000000511', ${currentOpenId}, 1, 3,
       '00000000-0000-4000-8000-000000000301'),
      ('00000000-0000-4000-8000-000000000512', ${currentClosedId}, 1, 2,
       '00000000-0000-4000-8000-000000000301'),
      ('00000000-0000-4000-8000-000000000513', ${previousAnnulledId}, 1, 2,
       '00000000-0000-4000-8000-000000000301')
  `);
  await database.run(sql`
    INSERT INTO venta_efectivo (venta_id, venta_efectivo_monto_recibido)
    VALUES (${currentOpenId}, 3000), (${previousAnnulledId}, 2000)
  `);
  await database.run(sql`
    INSERT INTO anulacion_venta (
      anulacion_venta_id, anulacion_fecha_hora, anulacion_razon, venta_id, usuario_id
    ) VALUES ('00000000-0000-4000-8000-000000000711',
      '2026-06-11T18:00:00.000Z', 'Error de venta', ${previousAnnulledId}, '12345678-9')
  `);
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
