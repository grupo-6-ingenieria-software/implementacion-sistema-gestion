import { sql, type SQL } from "drizzle-orm";
import type { InventoryExportItem } from "../../shared/inventory-export";

export type InventoryExportQueryExecutor = {
  all: <T>(query: SQL) => Promise<T[]>;
};
type InventoryQueryRow = Omit<
  InventoryExportItem,
  "categoria" | "precioCosto" | "precioVenta"
> & {
  categoria: string | null;
  precioCosto: number | null;
  precioVenta: number | null;
  historialesVigentes: number;
};

export class InventoryExportDataError extends Error {
  constructor(
    readonly productos: readonly { productoId: number; motivo: string }[],
  ) {
    super("El catálogo contiene datos que impiden exportar el inventario.");
    this.name = "InventoryExportDataError";
  }
}

/** CU20: una instantánea del catálogo completo, sin filtros del renderer. */
export async function queryInventoryExportWithExecutor(
  executor: InventoryExportQueryExecutor,
): Promise<InventoryExportItem[]> {
  const rows = await executor.all<InventoryQueryRow>(sql`
    WITH stock AS (
      SELECT producto_id, SUM(lote_cantidad_actual) AS cantidad
      FROM lote GROUP BY producto_id
    ), precios AS (
      SELECT producto_id, COUNT(*) AS cantidad,
        MAX(historial_precio_costo) AS costo,
        MAX(historial_precio_venta) AS venta
      FROM historial_precio_producto
      WHERE historial_fecha_hora_vigencia_hasta IS NULL
      GROUP BY producto_id
    )
    SELECT p.producto_id AS productoId, p.producto_ean_13 AS ean13,
      p.producto_nombre AS nombre, c.categoria_nombre AS categoria,
      COALESCE(s.cantidad, 0) AS stockActual,
      p.producto_stock_minimo AS stockMinimo, p.producto_estado AS estado,
      COALESCE(h.cantidad, 0) AS historialesVigentes,
      h.costo AS precioCosto, h.venta AS precioVenta
    FROM producto p
    LEFT JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN stock s ON s.producto_id = p.producto_id
    LEFT JOIN precios h ON h.producto_id = p.producto_id
    ORDER BY p.producto_nombre COLLATE NOCASE ASC, p.producto_ean_13 ASC
  `);

  const invalid = rows.flatMap((row) => {
    let motivo: string | undefined;
    if (Number(row.historialesVigentes) !== 1)
      motivo = "historial_vigente_no_unico";
    else if (typeof row.categoria !== "string") motivo = "categoria_ausente";
    else if (
      typeof row.nombre !== "string" ||
      typeof row.ean13 !== "string" ||
      !/^\d{13}$/.test(row.ean13) ||
      (row.estado !== "activo" && row.estado !== "inactivo") ||
      !Number.isSafeInteger(row.stockActual) ||
      !Number.isSafeInteger(row.stockMinimo) ||
      row.stockMinimo < 0 ||
      row.precioCosto === null ||
      !Number.isSafeInteger(row.precioCosto) ||
      row.precioCosto < 0 ||
      row.precioVenta === null ||
      !Number.isSafeInteger(row.precioVenta) ||
      row.precioVenta < 0
    )
      motivo = "datos_invalidos";
    return motivo ? [{ productoId: row.productoId, motivo }] : [];
  });
  if (invalid.length) throw new InventoryExportDataError(invalid);

  // MAX sólo se utiliza después de exigir COUNT = 1; nunca elige entre precios.
  return rows.map(({ historialesVigentes: _count, ...row }) => ({
    ...row,
    categoria: row.categoria!,
    precioCosto: row.precioCosto!,
    precioVenta: row.precioVenta!,
  }));
}
