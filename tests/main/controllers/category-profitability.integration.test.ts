import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { applyTriggers } from "../../../src/db/init";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { loadSaleCategories } from "../../../src/main/controllers/sale-categories-service";
import { queryCategoryProfitability } from "../../../src/main/controllers/category-profitability-service";

let fixture: AuthTestDatabase;
const usuarioId = "12345678-9";
const now = new Date("2026-06-12T15:00:00.000Z");
const periodo = { fechaInicio: "2026-06-12", fechaTermino: "2026-06-12" };

beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  await applyTriggers(fixture.client, join(process.cwd(), "src/db/triggers.sql"));
  await seedUser(fixture.db, { usuarioId, trabajadorId: 1, rut: usuarioId });
  await fixture.db.insert(schema.categoria).values([
    { categoriaId: 1, categoriaNombre: "Panadería", categoriaExigeVencimiento: false },
    { categoriaId: 2, categoriaNombre: "Sin costo", categoriaExigeVencimiento: false },
  ]);
  for (const productoId of [1, 2]) {
    await fixture.db.insert(schema.producto).values({
      productoId, productoEan13: productoId === 1 ? "7802920000015" : "7802920000022",
      productoNombre: `Producto ${productoId}`, productoPrecioVenta: 1000,
      productoStockMinimo: 0, productoEstado: "activo", categoriaId: productoId,
    });
    await fixture.db.insert(schema.historialPrecioProducto).values({
      historialPrecioCosto: 999, historialPrecioVenta: 1000,
      historialFechaHoraVigenciaDesde: "2026-01-01T00:00:00.000Z", productoId,
    });
  }
  for (const [productoId, costo, day] of [[1, 700, 1], [1, 900, 2], [2, 0, 1]]) {
    await fixture.db.insert(schema.lote).values({
      loteCantidadInicial: 1, loteCantidadActual: 1, lotePrecioCosto: costo,
      loteFechaHoraIngreso: `2026-01-0${day}T00:00:00.000Z`,
      esLotePerecible: false, esLoteNoPerecible: true, productoId,
    });
  }
  await fixture.db.insert(schema.cierreCaja).values({
    cierreFechaHoraInicio: "2026-06-12T08:00:00.000Z", cierreEstado: "abierto",
  });
});

afterEach(async () => {
  fixture?.client.close();
  if (fixture) await removeAuthTempDir(fixture.dir);
});

it("reads historical lot consumption with real migrations and triggers and reconciles net amounts with CU45", async () => {
  const ventaId = randomUUID();
  const [cash] = await fixture.db.select().from(schema.cierreCaja);
  await fixture.db.insert(schema.venta).values({
    ventaId, ventaFechaHora: now.toISOString(), ventaDescuentoTipo: "monto",
    ventaDescuentoValor: 1, ventaDescuentoRazon: "Promoción", ventaMetodoPago: "debito",
    ventaEstado: "completada", esVentaEfectivo: false, esVentaElectronica: true,
    usuarioCajeroId: usuarioId, ventaResponsableNombre: "María Huáscar",
    ventaResponsableRol: "dueno", cierreCajaId: cash.cierreCajaId,
  });
  const histories = await fixture.db.select().from(schema.historialPrecioProducto);
  for (const history of histories) {
    await fixture.db.insert(schema.detalleVenta).values({
      ventaId, productoId: history.productoId, detalleVentaCantidad: history.productoId === 1 ? 2 : 1,
      historialPrecioProductoId: history.historialPrecioProductoId,
    });
  }
  const lots = await fixture.db.select().from(schema.lote);
  for (const lot of lots) {
    await fixture.db.insert(schema.ventaLote).values({ ventaId, loteId: lot.loteId, ventaLoteCantidadConsumida: 1 });
  }
  await fixture.db.update(schema.lote).set({ loteCantidadActual: 0 });
  const before = await fixture.db.select().from(schema.lote);
  const report = await queryCategoryProfitability(fixture.db, periodo);
  const categories = await loadSaleCategories(fixture.db, periodo, { usuarioId, rol: "dueno" });
  expect(report.categorias).toEqual([
    { categoriaId: 1, categoriaNombre: "Panadería", unidadesVendidas: 2, costoTotal: 1600, ingresoNeto: 1999, gananciaPorcentual: 24.94 },
    { categoriaId: 2, categoriaNombre: "Sin costo", unidadesVendidas: 1, costoTotal: 0, ingresoNeto: 1000, gananciaPorcentual: null },
  ]);
  expect(report.categorias.reduce((sum, row) => sum + row.ingresoNeto, 0)).toBe(2999);
  expect(categories.totales.montoNeto).toBe(2999);
  expect(await fixture.db.select().from(schema.lote)).toEqual(before);
  expect(before.every((lot) => lot.loteCantidadActual === 0)).toBe(true);
});
