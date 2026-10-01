import * as schema from "../../../src/db/schema";
import type { AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";

export async function seedInventoryExport(
  fixture: AuthTestDatabase,
): Promise<void> {
  await fixture.db
    .insert(schema.categoria)
    .values({
      categoriaId: 1,
      categoriaNombre: "Lácteos",
      categoriaExigeVencimiento: true,
    });
  await fixture.db.insert(schema.producto).values([
    {
      productoId: 1,
      productoEan13: "0000000000001",
      productoNombre: "Leche <entera> & fresca",
      productoPrecioVenta: 9999,
      productoStockMinimo: 4,
      productoEstado: "activo",
      categoriaId: 1,
    },
    {
      productoId: 2,
      productoEan13: "0000000000002",
      productoNombre: "Zeta inactivo",
      productoPrecioVenta: 9999,
      productoStockMinimo: 0,
      productoEstado: "inactivo",
      categoriaId: 1,
    },
  ]);
  await fixture.db.insert(schema.historialPrecioProducto).values([
    {
      productoId: 1,
      historialPrecioCosto: 80,
      historialPrecioVenta: 150,
      historialFechaHoraVigenciaDesde: "2026-01-01",
    },
    {
      productoId: 1,
      historialPrecioCosto: 10,
      historialPrecioVenta: 20,
      historialFechaHoraVigenciaDesde: "2025-01-01",
      historialFechaHoraVigenciaHasta: "2025-12-31",
    },
    {
      productoId: 2,
      historialPrecioCosto: 0,
      historialPrecioVenta: 0,
      historialFechaHoraVigenciaDesde: "2026-01-01",
    },
  ]);
  const lots = await fixture.db
    .insert(schema.lote)
    .values([
      {
        productoId: 1,
        loteCantidadInicial: 2,
        loteCantidadActual: 2,
        lotePrecioCosto: 11,
        esLotePerecible: true,
        esLoteNoPerecible: false,
      },
      {
        productoId: 1,
        loteCantidadInicial: 5,
        loteCantidadActual: 5,
        lotePrecioCosto: 22,
        esLotePerecible: true,
        esLoteNoPerecible: false,
      },
    ])
    .returning();
  await fixture.db
    .insert(schema.lotePerecible)
    .values(
      lots.map((lot) => ({
        loteId: lot.loteId,
        lotePerecibleFechaVencimiento: "2020-01-01",
      })),
    );
}
