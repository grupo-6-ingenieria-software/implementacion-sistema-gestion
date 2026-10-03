import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import {
  createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import { queryMovementReportFromDb } from "../../../src/main/controllers/movement-report";
import { movementHistoryController } from "../../../src/main/controllers/movement-history";

// Exercise the existing queries against a temporary database, without replacing them.
const database = vi.hoisted(() => ({ current: undefined as unknown as typeof import("../../../src/db/client").db }));
vi.mock("../../../src/db/client", async () => ({
  get db() { return database.current; },
  schema: await import("../../../src/db/schema"),
}));

let fixture: AuthTestDatabase;
const owner = "11111111-1";
const ean13 = "7802920000015";
const initialLot = randomUUID();
const receiptLot = randomUUID();
const saleId = randomUUID();
const adjustmentId = randomUUID();

beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  database.current = fixture.db;
  await seedUser(fixture.db, { usuarioId: owner, rut: owner, trabajadorId: 1 });
  await fixture.db.insert(schema.categoria).values({ categoriaId: 1, categoriaNombre: "Bebidas", categoriaExigeVencimiento: false });
  await fixture.db.insert(schema.producto).values([
    { productoId: 1, productoEan13: ean13, productoNombre: "Coca-Cola", productoPrecioVenta: 1800, categoriaId: 1 },
    { productoId: 2, productoEan13: "4006381333931", productoNombre: "Otro producto", productoPrecioVenta: 1000, categoriaId: 1 },
  ]);
  await fixture.db.insert(schema.lote).values([
    { loteId: initialLot, productoId: 1, loteCantidadInicial: 48, loteCantidadActual: 51, lotePrecioCosto: 1200,
      esLotePerecible: false, esLoteNoPerecible: true, loteFechaHoraIngreso: "2026-10-03 21:18:05" },
    { loteId: receiptLot, productoId: 1, loteCantidadInicial: 5, loteCantidadActual: 5, lotePrecioCosto: 1200,
      esLotePerecible: false, esLoteNoPerecible: true, loteFechaHoraIngreso: "2026-10-03 21:19:15" },
    { productoId: 2, loteCantidadInicial: 10, loteCantidadActual: 10, lotePrecioCosto: 500,
      esLotePerecible: false, esLoteNoPerecible: true, loteFechaHoraIngreso: "2026-10-03 21:18:05" },
  ]);
  const [cash] = await fixture.db.insert(schema.cierreCaja).values({ cierreFechaHoraInicio: "2026-10-03T03:00:00Z" }).returning();
  await fixture.db.insert(schema.venta).values({
    ventaId: saleId, ventaFechaHora: "2026-10-03T21:18:44.376Z", ventaMetodoPago: "efectivo",
    ventaEstado: "anulada", esVentaEfectivo: true, esVentaElectronica: false,
    usuarioCajeroId: owner, ventaResponsableNombre: "María Huáscar", ventaResponsableRol: "dueno", cierreCajaId: cash.cierreCajaId,
  });
  await fixture.db.insert(schema.ventaLote).values({ ventaId: saleId, loteId: initialLot, ventaLoteCantidadConsumida: 2 });
  await fixture.db.insert(schema.anulacionVenta).values({
    ventaId: saleId, usuarioId: owner, anulacionRazon: "Prueba", anulacionFechaHora: "2026-10-03T21:19:02.482Z",
  });
  await fixture.db.insert(schema.ajusteInventario).values({
    ajusteInventarioId: adjustmentId, productoId: 1, loteId: initialLot, usuarioId: owner,
    ajusteCantidad: 3, ajusteJustificacion: "Reconteo", ajusteFechaHora: "2026-10-03 21:19:06",
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (fixture) {
    fixture.client.close();
    await removeAuthTempDir(fixture.dir);
  }
});

describe("movement queries with real SQL and ISO timestamps", () => {
  it("orders events by instant and reconstructs each product's historical balances", async () => {
    const report = await queryMovementReportFromDb({ fechaInicio: "2026-10-03", fechaTermino: "2026-10-03" });
    expect(report.items.filter(item => item.productoId === 1).map(item => [item.tipo, item.cantidad, item.saldo])).toEqual([
      ["ingreso_lote", 5, 56], ["ajuste_manual", 3, 51], ["restitucion", 2, 48], ["venta", -2, 46], ["ingreso_lote", 48, 48],
    ]);
    expect(report.items.find(item => item.productoId === 2)?.saldo).toBe(10);
    expect(report.resumen).toMatchObject({ totalMovimientos: 6, totalEntradas: 68, totalSalidas: 2 });
  });

  it("keeps earlier stock in the balance when filtering by period, type and user", async () => {
    await fixture.db.update(schema.lote).set({ loteFechaHoraIngreso: "2026-10-02 15:00:00" }).where(eq(schema.lote.loteId, initialLot));
    const report = await queryMovementReportFromDb({ fechaInicio: "2026-10-03", fechaTermino: "2026-10-03", tipo: "venta", categoriaId: 1, usuarioFiltroId: owner });
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({ tipo: "venta", cantidad: -2, saldo: 46 });
    expect(report.resumen).toMatchObject({ totalMovimientos: 1, totalEntradas: 0, totalSalidas: 2 });
  });

  it.each([
    ["2026-10-03", "2026-10-03T02:30:00.000Z", false],
    ["2026-10-03", "2026-10-03T03:00:00.000Z", true],
    ["2026-10-03", "2026-10-04T02:59:59.999Z", true],
    ["2026-10-03", "2026-10-04T03:00:00.000Z", false],
    ["2026-06-12", "2026-06-12T03:30:00.000Z", false],
    ["2026-06-12", "2026-06-12T04:00:00.000Z", true],
    ["2026-06-12", "2026-06-13T03:59:59.999Z", true],
    ["2026-06-12", "2026-06-13T04:00:00.000Z", false],
  ])("filters Chilean day %s correctly for ISO timestamp %s", async (day, timestamp, included) => {
    await fixture.db.update(schema.venta).set({ ventaFechaHora: timestamp }).where(eq(schema.venta.ventaId, saleId));
    const report = await queryMovementReportFromDb({ fechaInicio: day, fechaTermino: day, tipo: "venta" });
    expect(report.items).toHaveLength(included ? 1 : 0);
  });

  it("uses UTC for timestamps without a zone regardless of the machine timezone", async () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const report = await queryMovementReportFromDb({ fechaInicio: "2026-10-03", fechaTermino: "2026-10-03" });
    expect(report.items.filter(item => item.productoId === 1).map(item => item.saldo)).toEqual([56, 51, 48, 46, 48]);
  });

  it("orders V22 before pagination while preserving its product filter", async () => {
    await fixture.db.delete(schema.anulacionVenta).where(eq(schema.anulacionVenta.ventaId, saleId));
    await fixture.db.update(schema.venta).set({ ventaEstado: "completada" }).where(eq(schema.venta.ventaId, saleId));
    const first = await movementHistoryController.handle({ usuarioId: owner, ean13, page: 1, pageSize: 2 }, { channel: "movimiento:historial" });
    const second = await movementHistoryController.handle({ usuarioId: owner, ean13, page: 2, pageSize: 2 }, { channel: "movimiento:historial" });
    expect(first).toMatchObject({ ok: true, data: { total: 4, page: 1, pageSize: 2, movements: [{ id: receiptLot }, { id: adjustmentId }] } });
    expect(second).toMatchObject({ ok: true, data: { total: 4, page: 2, pageSize: 2, movements: [{ tipo: "venta" }, { id: initialLot }] } });
  });
});
