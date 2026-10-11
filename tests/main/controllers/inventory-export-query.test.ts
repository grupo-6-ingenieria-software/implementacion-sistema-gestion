import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import {
  InventoryExportDataError,
  queryInventoryExportWithExecutor,
} from "../../../src/main/controllers/inventory-export-query";
import { seedInventoryExport } from "./inventory-export-fixture";

let fixture: AuthTestDatabase;
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
});
afterEach(async () => {
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

describe("instantánea completa de inventario CU20 (T03/T04)", () => {
  it("incluye productos inactivos y lotes vencidos sin multiplicar el stock por históricos", async () => {
    await seedInventoryExport(fixture);
    const rows = await queryInventoryExportWithExecutor(fixture.db);
    expect(rows).toEqual([
      {
        productoId: 1,
        ean13: "0000000000001",
        nombre: "Leche <entera> & fresca",
        categoria: "Lácteos",
        stockActual: 7,
        stockMinimo: 4,
        precioCosto: 80,
        precioVenta: 150,
        estado: "activo",
      },
      {
        productoId: 2,
        ean13: "0000000000002",
        nombre: "Zeta inactivo",
        categoria: "Lácteos",
        stockActual: 0,
        stockMinimo: 0,
        precioCosto: 0,
        precioVenta: 0,
        estado: "inactivo",
      },
    ]);
  });
  it("devuelve vacío solo cuando el maestro de productos está vacío", async () => {
    expect(await queryInventoryExportWithExecutor(fixture.db)).toEqual([]);
    await seedInventoryExport(fixture);
    await fixture.db
      .update(schema.producto)
      .set({ productoEstado: "inactivo" });
    expect(await queryInventoryExportWithExecutor(fixture.db)).toHaveLength(2);
  });
  it("rechaza un histórico ausente aunque el maestro tenga precio de venta", async () => {
    await seedInventoryExport(fixture);
    await fixture.db
      .delete(schema.historialPrecioProducto)
      .where(eq(schema.historialPrecioProducto.productoId, 2));
    await expect(
      queryInventoryExportWithExecutor(fixture.db),
    ).rejects.toMatchObject({
      productos: [{ productoId: 2, motivo: "historial_vigente_no_unico" }],
    });
  });
  it("rechaza múltiples históricos abiertos en lugar de elegir el más reciente", async () => {
    await seedInventoryExport(fixture);
    await fixture.db
      .insert(schema.historialPrecioProducto)
      .values({
        productoId: 1,
        historialPrecioCosto: 999,
        historialPrecioVenta: 1000,
      });
    await expect(
      queryInventoryExportWithExecutor(fixture.db),
    ).rejects.toBeInstanceOf(InventoryExportDataError);
  });
  it("no omite silenciosamente un producto con una relación de categoría rota", async () => {
    await seedInventoryExport(fixture);
    await fixture.client.execute("PRAGMA foreign_keys = OFF");
    await fixture.db.run(
      sql`UPDATE producto SET categoria_id = 999 WHERE producto_id = 2`,
    );
    await expect(
      queryInventoryExportWithExecutor(fixture.db),
    ).rejects.toMatchObject({
      productos: [{ productoId: 2, motivo: "categoria_ausente" }],
    });
  });
  it("ordena de forma determinista y vuelve a leer el stock persistido en cada invocación", async () => {
    await seedInventoryExport(fixture);
    await fixture.db
      .insert(schema.producto)
      .values({
        productoId: 3,
        productoEan13: "0000000000000",
        productoNombre: "Zeta inactivo",
        productoPrecioVenta: 1,
        categoriaId: 1,
      });
    await fixture.db
      .insert(schema.historialPrecioProducto)
      .values({
        productoId: 3,
        historialPrecioCosto: 1,
        historialPrecioVenta: 2,
      });
    const first = await queryInventoryExportWithExecutor(fixture.db);
    expect(first.map((row) => row.productoId)).toEqual([1, 3, 2]);
    await fixture.db.update(schema.lote).set({ loteCantidadActual: 1 });
    expect(
      (await queryInventoryExportWithExecutor(fixture.db))[0].stockActual,
    ).toBe(2);
    expect(first[0].stockActual).toBe(7);
  });
});
