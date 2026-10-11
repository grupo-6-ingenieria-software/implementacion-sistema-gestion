import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main", () => ({ default: { error: vi.fn() } }));
vi.mock("../../../src/db/client", () => ({ db: {}, schema: {} }));

import * as schema from "../../../src/db/schema";
import { registerAuditLog } from "../../../src/main/controllers/auth-context";
import { createReceiptPrintController } from "../../../src/main/controllers/receipt-print";
import { createPrinterTransport } from "../../../src/main/controllers/receipt-printer-transport";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";
import { loadSaleDetail, type SalesHistoryDb } from "../../../src/main/controllers/sales-history";

const cashSaleId = "00000000-0000-4000-8000-000000000911";
const annulledSaleId = "00000000-0000-4000-8000-000000000912";
const claims: SessionTokenClaims = { usuarioId: "12345678-9", rol: "trabajador", usuarioRol: "trabajador", passwordTemporal: false, sesionId: "00000000-0000-4000-8000-000000000701" };

type Fixture = Awaited<ReturnType<typeof createTestDatabase>>;
let fixture: Fixture | undefined;
let server: Server | undefined;
let printerPort = 0;
let jobs: Buffer[] = [];
const logFailure = vi.fn();

beforeEach(async () => {
  fixture = await createTestDatabase();
  await seed(fixture.db as unknown as DbExecutor);
  jobs = [];
  await new Promise<void>((resolve) => {
    server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => {
        jobs.push(Buffer.concat(chunks));
        socket.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      printerPort = typeof address === "object" && address ? address.port : 0;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  if (fixture) {
    fixture.client.close();
    await rm(fixture.dir, { recursive: true, force: true }).catch(() => undefined);
    fixture = undefined;
  }
  logFailure.mockReset();
});

async function controllerWithPrinter() {
  return createReceiptPrintController({
    loadSale: (ventaId) => loadSaleDetail(fixture!.db as unknown as SalesHistoryDb, { ventaId }),
    printer: { transport: "tcp", host: "127.0.0.1", port: printerPort, paperWidth: 80 },
    transport: createPrinterTransport(),
    audit: (event) => registerAuditLog(fixture!.db, schema, event),
    logFailure,
    now: () => new Date("2026-06-12T19:30:00.000Z"),
  });
}

async function auditRows() {
  return fixture!.db.all<{ tipo: string; descripcion: string }>(sql`
    SELECT log_tipo_accion AS tipo, log_descripcion AS descripcion FROM log_auditoria
  `);
}

describe("RF63 integración de impresión de boletas con base de datos y transporte TCP", () => {
  it("imprime la boleta desde la venta persistida y no audita la impresión automática", async () => {
    const controller = await controllerWithPrinter();

    const response = await controller.handle({ ventaId: cashSaleId }, { channel: "boleta:imprimir", claims });

    expect(response).toMatchObject({ ok: true, data: { ventaId: cashSaleId, copia: false } });
    expect(jobs).toHaveLength(1);
    const body = jobs[0].toString("latin1");
    expect(body).toContain(cashSaleId.toUpperCase());
    expect(body).toContain("CAJERO: ANA HISTORICA");
    expect(body).toMatch(/7802920000015 {2}1\.000 X 3 UN = \$\s+3\.000/);
    expect(body).toContain("DESCUENTO: -$ 500");
    expect(body).toContain("RAZON DESCUENTO: PROMOCION");
    expect(body).toContain("TOTAL: $ 2.500");
    expect(body).toContain("PAGOS: $ 3.000");
    expect(body).toContain("VUELTO: $ 500");
    expect(body.endsWith("\x1b\x64\x04\x1d\x56\x00")).toBe(true);
    expect(await auditRows()).toEqual([]);
  });

  it("reimprime la copia y deja la reimpresión en log_auditoria", async () => {
    const controller = await controllerWithPrinter();

    const response = await controller.handle({ ventaId: cashSaleId, copia: true }, { channel: "boleta:imprimir", claims });

    expect(response).toMatchObject({ ok: true, data: { copia: true } });
    expect(jobs[0].toString("latin1")).toContain("COPIA REIMPRESA 12-06-2026 15:30:00");
    expect(await auditRows()).toEqual([
      { tipo: "reimpresion_boleta", descripcion: `Reimpresión de boleta de la venta ${cashSaleId}.` },
    ]);
  });

  it("no reimprime ventas anuladas", async () => {
    const controller = await controllerWithPrinter();

    const response = await controller.handle({ ventaId: annulledSaleId, copia: true }, { channel: "boleta:imprimir", claims });

    expect(response).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE" } });
    expect(jobs).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  it("con la impresora apagada conserva la venta, registra la falla y no audita", async () => {
    const controller = await controllerWithPrinter();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    const response = await controller.handle({ ventaId: cashSaleId, copia: true }, { channel: "boleta:imprimir", claims });

    expect(response).toMatchObject({ ok: false, error: { code: "TECHNICAL_ERROR" } });
    expect(logFailure).toHaveBeenCalledOnce();
    expect(await auditRows()).toEqual([]);
    const [venta] = await fixture!.db.all<{ estado: string }>(sql`
      SELECT venta_estado AS estado FROM venta WHERE venta_id = ${cashSaleId}
    `);
    expect(venta.estado).toBe("completada");
  });
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-rf63-"));
  const client = createClient({ url: `file:${join(dir, "test.db").replace(/\\/g, "/")}` });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys = ON");
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await client.executeMultiple(await readFile(join(migrationsDir, file), "utf8"));
  }
  await client.executeMultiple(await readFile(join(process.cwd(), "src/db/triggers.sql"), "utf8"));
  return { client, db, dir };
}

async function seed(database: DbExecutor): Promise<void> {
  await database.run(sql`
    INSERT INTO trabajador (
      trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
      trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado
    ) VALUES (1, '12345678-9', 'Ana', 'Histórica', '987654321', '2024-01-01', 'activo')
  `);
  await database.run(sql`
    INSERT INTO usuario (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES ('12345678-9', 'trabajador', '2026-01-01T00:00:00.000Z', 1)
  `);
  await database.run(sql`
    INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES (1, 'Abarrotes', 0)
  `);
  await database.run(sql`
    INSERT INTO producto (
      producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
      producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id
    ) VALUES (1, '7802920000015', 'Pan amasado', 9999, 1, 'activo', '2026-01-01T00:00:00.000Z', 1)
  `);
  await database.run(sql`
    INSERT INTO historial_precio_producto (
      historial_precio_producto_id, historial_precio_costo,
      historial_precio_venta, historial_fecha_hora_vigencia_desde, producto_id
    ) VALUES ('00000000-0000-4000-8000-000000000301', 700, 1000, '2026-01-01T00:00:00.000Z', 1)
  `);
  await database.run(sql`
    INSERT INTO cierre_caja (cierre_caja_id, cierre_fecha_hora_inicio, cierre_estado)
    VALUES ('00000000-0000-4000-8000-000000000201', '2026-06-12T08:00:00.000Z', 'abierto')
  `);
  await database.run(sql`
    INSERT INTO venta (
      venta_id, venta_fecha_hora, venta_descuento_tipo, venta_descuento_valor,
      venta_descuento_razon, venta_metodo_pago, venta_estado,
      es_venta_efectivo, es_venta_electronica, usuario_cajero_id,
      venta_responsable_nombre, venta_responsable_rol, cierre_caja_id
    ) VALUES
      (${cashSaleId}, '2026-06-12T17:00:00.000Z', 'monto', 500, 'Promoción',
       'efectivo', 'completada', 1, 0, '12345678-9', 'Ana Histórica', 'trabajador',
       '00000000-0000-4000-8000-000000000201'),
      (${annulledSaleId}, '2026-06-12T16:00:00.000Z', 'ninguno', NULL, NULL,
       'debito', 'completada', 0, 1, '12345678-9', 'Ana Histórica', 'trabajador',
       '00000000-0000-4000-8000-000000000201')
  `);
  await database.run(sql`
    INSERT INTO detalle_venta (
      detalle_venta_id, venta_id, producto_id, detalle_venta_cantidad, historial_precio_producto_id
    ) VALUES
      ('00000000-0000-4000-8000-000000000511', ${cashSaleId}, 1, 3, '00000000-0000-4000-8000-000000000301'),
      ('00000000-0000-4000-8000-000000000512', ${annulledSaleId}, 1, 1, '00000000-0000-4000-8000-000000000301')
  `);
  await database.run(sql`
    INSERT INTO venta_efectivo (venta_id, venta_efectivo_monto_recibido) VALUES (${cashSaleId}, 3000)
  `);
  await database.run(sql`
    INSERT INTO anulacion_venta (anulacion_venta_id, anulacion_fecha_hora, anulacion_razon, venta_id, usuario_id)
    VALUES ('00000000-0000-4000-8000-000000000711', '2026-06-12T16:30:00.000Z', 'Error de venta', ${annulledSaleId}, '12345678-9')
  `);
}
