import { sql, type SQL } from "drizzle-orm";
import { allocateRecordedSaleNetAmounts } from "../../shared/sales";
import {
  parseProfitabilityPeriod, type CategoryProfitability, type CategoryProfitabilityReport,
  type ProfitabilityPeriod,
} from "../../shared/category-profitability";
import { getChileDateRange } from "./dashboard-date";

export type ProfitabilityExecutor = { all: <T>(query: SQL) => Promise<T[]> };
type ProfitabilityRow = {
  ventaId: string;
  detalleVentaId: string;
  discountType: "ninguno" | "monto" | "porcentaje";
  discountValue: number | null;
  cantidad: number;
  precioUnitario: number;
  categoriaId: number;
  categoriaNombre: string;
  costoTotal: number | null;
  unidadesConsumidas: number | null;
};

export async function queryCategoryProfitability(
  database: ProfitabilityExecutor,
  payload: ProfitabilityPeriod,
): Promise<CategoryProfitabilityReport> {
  const periodo = parseProfitabilityPeriod(payload);
  const { startUtc, endUtc } = getChileDateRange(periodo.fechaInicio, periodo.fechaTermino);
  const rows = await database.all<ProfitabilityRow>(sql`
    WITH ventas_vigentes AS (
      SELECT v.* FROM venta v
      WHERE v.venta_estado = 'completada'
        AND NOT EXISTS (SELECT 1 FROM anulacion_venta av WHERE av.venta_id = v.venta_id)
        AND datetime(v.venta_fecha_hora) >= datetime(${startUtc})
        AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    ), costos_consumidos AS (
      SELECT vl.venta_id, l.producto_id,
        SUM(vl.venta_lote_cantidad_consumida * l.lote_precio_costo) AS costoTotal,
        SUM(vl.venta_lote_cantidad_consumida) AS unidadesConsumidas
      FROM venta_lote vl
      JOIN ventas_vigentes v ON v.venta_id = vl.venta_id
      JOIN lote l ON l.lote_id = vl.lote_id
      GROUP BY vl.venta_id, l.producto_id
    )
    SELECT v.venta_id AS ventaId, dv.detalle_venta_id AS detalleVentaId,
      v.venta_descuento_tipo AS discountType, v.venta_descuento_valor AS discountValue,
      dv.detalle_venta_cantidad AS cantidad, hp.historial_precio_venta AS precioUnitario,
      c.categoria_id AS categoriaId, c.categoria_nombre AS categoriaNombre,
      cc.costoTotal, cc.unidadesConsumidas
    FROM ventas_vigentes v
    JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    JOIN historial_precio_producto hp ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    JOIN producto p ON p.producto_id = dv.producto_id
    JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN costos_consumidos cc ON cc.venta_id = v.venta_id AND cc.producto_id = dv.producto_id
    ORDER BY v.venta_id, dv.detalle_venta_id
  `);
  const bySale = new Map<string, ProfitabilityRow[]>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.cantidad) || row.cantidad <= 0 ||
        !Number.isSafeInteger(row.precioUnitario) || row.precioUnitario < 0 ||
        row.costoTotal === null || !Number.isSafeInteger(row.costoTotal) || row.costoTotal < 0 ||
        row.unidadesConsumidas !== row.cantidad) {
      throw new Error("Las unidades vendidas y sus costos de lote son incoherentes.");
    }
    const group = bySale.get(row.ventaId) ?? [];
    group.push(row);
    bySale.set(row.ventaId, group);
  }
  const categories = new Map<number, CategoryProfitability>();
  for (const saleRows of bySale.values()) {
    const netLines = allocateRecordedSaleNetAmounts(saleRows[0], saleRows.map((row) => ({
      id: row.detalleVentaId, subtotal: row.cantidad * row.precioUnitario,
    })));
    saleRows.forEach((row, index) => {
      const category = categories.get(row.categoriaId) ?? {
        categoriaId: row.categoriaId, categoriaNombre: row.categoriaNombre,
        unidadesVendidas: 0, costoTotal: 0, ingresoNeto: 0, gananciaPorcentual: null,
      };
      category.unidadesVendidas = safeAdd(category.unidadesVendidas, row.cantidad);
      category.costoTotal = safeAdd(category.costoTotal, row.costoTotal!);
      category.ingresoNeto = safeAdd(category.ingresoNeto, netLines[index].montoNeto);
      categories.set(category.categoriaId, category);
    });
  }
  const categorias = [...categories.values()];
  for (const category of categorias) {
    category.gananciaPorcentual = category.costoTotal === 0 ? null :
      Number(((category.ingresoNeto - category.costoTotal) / category.costoTotal * 100).toFixed(2));
  }
  categorias.sort((a, b) => {
    if (a.gananciaPorcentual === null && b.gananciaPorcentual !== null) return 1;
    if (b.gananciaPorcentual === null && a.gananciaPorcentual !== null) return -1;
    return (b.gananciaPorcentual ?? 0) - (a.gananciaPorcentual ?? 0) ||
      a.categoriaNombre.localeCompare(b.categoriaNombre, "es") || a.categoriaId - b.categoriaId;
  });
  return { periodo, categorias };
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("El reporte excede el rango de importes admitido.");
  return result;
}
