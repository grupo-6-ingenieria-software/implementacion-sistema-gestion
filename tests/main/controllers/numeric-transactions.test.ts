import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { applyTriggers } from "../../../src/db/init";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { registerLotWithExecutor } from "../../../src/main/controllers/lot";
import { executeAdjustmentWithExecutor } from "../../../src/main/controllers/stock-adjustment";
import { registerSupplierOrderWithExecutor } from "../../../src/main/controllers/supplier-order";
import { confirmSupplierOrderReceptionWithExecutor } from "../../../src/main/controllers/supplier-order-reception";
import { registerSale, type DbExecutor } from "../../../src/main/controllers/sale-service";
import { annulSale } from "../../../src/main/controllers/sale-annulment-service";
import { NumericRangeError } from "../../../src/shared/numbers";
import { queryInventoryProducts } from "../../../src/main/controllers/product-query";
import { queryInventoryValuationWithExecutor } from "../../../src/main/controllers/inventory-valuation";
import { loadDashboardData } from "../../../src/main/controllers/dashboard-service";
import { defaultProductListFilters } from "../../../src/shared/products";

describe("precisión transaccional de inventario y ventas", () => {
  let fixture: AuthTestDatabase;
  const owner = "12345678-9";
  const sessionId = "00000000-0000-4000-8000-000000000091";
  const now = new Date("2026-06-12T18:00:00.000Z");
  const ean = "7802920000015";
  const secondEan = "7802920000022";
  const actor = { usuarioId: owner, sesionId: sessionId, rol: "dueno" as const };
  const database = () => fixture.db as unknown as DbExecutor;

  beforeEach(async () => {
    fixture = await createAuthTestDatabase();
    await seedUser(fixture.db, { usuarioId: owner, rut: owner, trabajadorId: 1 });
    await fixture.db.insert(schema.sesionUsuario).values({ sesionUsuarioId: sessionId, usuarioId: owner, sesionRolEfectivo: "dueno", sesionFechaHoraUltimoAcceso: now.toISOString() });
    await fixture.db.insert(schema.categoria).values({ categoriaId: 1, categoriaNombre: "Bebidas", categoriaExigeVencimiento: false });
    await fixture.db.insert(schema.proveedor).values({ proveedorId: 1, proveedorRut: "76543210-9", proveedorNombreRazonSocial: "Proveedor", proveedorNombreContacto: "Contacto", proveedorTelefono: "987654321", proveedorCorreoElectronico: "proveedor@example.cl" });
    for (const [id, code] of [[1, ean], [2, secondEan]] as const) {
      await fixture.db.insert(schema.producto).values({ productoId: id, productoEan13: code, productoNombre: `Producto ${id}`, productoPrecioVenta: 20, productoStockMinimo: 1, categoriaId: 1 });
      await fixture.db.insert(schema.historialPrecioProducto).values({ productoId: id, historialPrecioCosto: 1, historialPrecioVenta: 20 });
    }
    await applyTriggers(fixture.client, join(process.cwd(), "src/db/triggers.sql"));
  });
  afterEach(async () => { fixture.client.close(); await removeAuthTempDir(fixture.dir); });

  const lot = (cantidad: number, precioCosto = 1, code = ean) => fixture.db.transaction(tx =>
    registerLotWithExecutor(tx, schema, { ean13: code, cantidad, precioCosto, proveedorId: 1, usuarioId: owner }));

  async function snapshot() {
    return fixture.db.all(sql`SELECT
      (SELECT COUNT(*) FROM lote) AS lotes, (SELECT TOTAL(lote_cantidad_actual) FROM lote) AS stock,
      (SELECT COUNT(*) FROM ajuste_inventario) AS ajustes, (SELECT COUNT(*) FROM log_auditoria) AS auditorias,
      (SELECT COUNT(*) FROM venta) AS ventas, (SELECT COUNT(*) FROM venta_lote) AS consumos,
      (SELECT COUNT(*) FROM anulacion_venta) AS anulaciones, (SELECT COUNT(*) FROM recepcion_pedido) AS recepciones`);
  }

  it("revierte un lote cuyos operandos seguros producen valorización insegura", async () => {
    const before = await snapshot();
    await expect(lot(500000000, 500000000)).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
  });

  it("rechaza una entrada que desborda la suma de lotes", async () => {
    await lot(Number.MAX_SAFE_INTEGER - 1);
    const before = await snapshot();
    await expect(lot(2)).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
  });

  it("revierte el ajuste cuando la valorización resultante sale de rango", async () => {
    const created = await lot(1, Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1);
    const before = await snapshot();
    await expect(executeAdjustmentWithExecutor(fixture.db, schema, { ean13: ean, loteId: created.loteId, cantidad: 1, justificacion: "Conteo", usuarioId: owner }))
      .rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
  });

  it("revierte lote, recepción y saldo de pedido al desbordar valorización", async () => {
    const order = await fixture.db.transaction(tx => registerSupplierOrderWithExecutor(tx, schema, { proveedorId: 1, usuarioId: owner, lineas: [{ ean13: ean, cantidad: 500000000 }] }));
    const [line] = await fixture.db.select().from(schema.detallePedido);
    const before = await snapshot();
    await expect(fixture.db.transaction(tx => confirmSupplierOrderReceptionWithExecutor(tx, schema, {
      pedidoId: order.pedidoId, operacionId: randomUUID(), usuarioId: owner,
      lineas: [{ detallePedidoId: line.detallePedidoId, cantidad: 500000000, precioCosto: 500000000 }],
    }))).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
    expect((await fixture.db.select().from(schema.detallePedido))[0].cantidadRecibida).toBe(0);
  });

  it("rechaza cantidades de pedido que desbordan su total antes de guardar", async () => {
    const before = await snapshot();
    await expect(fixture.db.transaction(tx => registerSupplierOrderWithExecutor(tx, schema, {
      proveedorId: 1, usuarioId: owner,
      lineas: [{ ean13: ean, cantidad: Number.MAX_SAFE_INTEGER }, { ean13: secondEan, cantidad: 1 }],
    }))).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
    expect(await fixture.db.select().from(schema.pedidoProveedor)).toHaveLength(0);
  });

  it("rechaza un subtotal no seguro y efectivo no seguro sin crear venta", async () => {
    await lot(500000000);
    await fixture.db.run(sql`UPDATE historial_precio_producto SET historial_precio_venta = 500000000 WHERE producto_id = 1`);
    const before = await snapshot();
    await expect(registerSale(database(), { metodoPago: "debito", items: [{ productoId: 1, cantidad: 500000000 }] }, actor, now)).rejects.toBeInstanceOf(NumericRangeError);
    await expect(registerSale(database(), { metodoPago: "efectivo", montoRecibido: 1e17, items: [{ productoId: 1, cantidad: 1 }] }, actor, now)).rejects.toThrow("monto recibido");
    expect(await snapshot()).toEqual(before);
  });

  it("revierte una venta que desborda el acumulado del día", async () => {
    await lot(1);
    await lot(1, 1, secondEan);
    await fixture.db.run(sql`UPDATE historial_precio_producto SET historial_precio_venta = ${Number.MAX_SAFE_INTEGER - 1} WHERE producto_id = 1`);
    await registerSale(database(), { metodoPago: "debito", items: [{ productoId: 1, cantidad: 1 }] }, actor, now);
    const before = await snapshot();
    await expect(registerSale(database(), { metodoPago: "debito", items: [{ productoId: 2, cantidad: 1 }] }, actor, now)).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
  });

  it("rechaza cantidades duplicadas cuyo acumulado no es seguro", async () => {
    const before = await snapshot();
    await expect(registerSale(database(), {
      metodoPago: "debito",
      items: [
        { productoId: 1, cantidad: Number.MAX_SAFE_INTEGER },
        { productoId: 1, cantidad: 1 },
      ],
    }, actor, now)).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
  });

  it("rechaza un carrito con líneas seguras cuyo total no lo es", async () => {
    await lot(1);
    await lot(1, 1, secondEan);
    await fixture.db.run(sql`UPDATE historial_precio_producto
      SET historial_precio_venta = ${Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1}`);
    const before = await snapshot();
    await expect(registerSale(database(), {
      metodoPago: "debito",
      items: [{ productoId: 1, cantidad: 1 }, { productoId: 2, cantidad: 1 }],
    }, actor, now)).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
  });

  it("revierte la anulación completa si su restitución desborda inventario", async () => {
    const created = await lot(1, Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1);
    const sale = await registerSale(database(), { metodoPago: "debito", items: [{ productoId: 1, cantidad: 1 }] }, actor, now);
    await executeAdjustmentWithExecutor(fixture.db, schema, { ean13: ean, loteId: created.loteId, cantidad: 1, justificacion: "Conteo", usuarioId: owner });
    const before = await snapshot();
    await expect(annulSale(database(), { ventaId: sale.ventaId, razon: "Devolución", usuarioId: owner }, now)).rejects.toBeInstanceOf(NumericRangeError);
    expect(await snapshot()).toEqual(before);
    expect((await fixture.db.select().from(schema.venta))[0].ventaEstado).toBe("completada");
  });

  it("detecta un stock antiguo no seguro sin fallar en el decoder de libSQL", async () => {
    await fixture.db.insert(schema.lote).values({ productoId: 1, loteCantidadInicial: 1e17, loteCantidadActual: 1e17, lotePrecioCosto: 1, esLotePerecible: false, esLoteNoPerecible: true });
    await expect(queryInventoryProducts(fixture.db, schema, { filters: defaultProductListFilters, includeCost: true })).rejects.toBeInstanceOf(NumericRangeError);
    await expect(queryInventoryValuationWithExecutor(fixture.db)).rejects.toBeInstanceOf(NumericRangeError);
    await expect(loadDashboardData(database(), { role: "dueno", usuarioId: owner }, now)).rejects.toBeInstanceOf(NumericRangeError);
  });
});
