import { sql, type SQL } from "drizzle-orm";
import { safeInteger, NumericRangeError } from "../../shared/numbers";
import { getDashboardDay } from "./dashboard-date";

export type SqlValidationExecutor = {
  all: <TRow>(query: SQL) => PromiseLike<TRow[]>;
};
export type SqlScalar = number | string | null;

export function numericSqlValue(value: number): SqlScalar {
  return Number.isFinite(value) ? value : "__invalid_numeric__";
}

export const integerExpression = (value: SqlScalar | SQL) => sql<number>`
  typeof(${value}) IN ('integer', 'real')
  AND ${value} = CAST(${value} AS INTEGER)
  AND ${value} BETWEEN ${-Number.MAX_SAFE_INTEGER} AND ${Number.MAX_SAFE_INTEGER}
`;

/** Se ejecuta dentro de la escritura: un resultado inválido revierte toda la operación. */
export async function assertInventoryTotals(
  executor: SqlValidationExecutor,
): Promise<void> {
  const [totals] = await executor.all<{ units: number; value: number; invalid: number }>(sql`
    SELECT TOTAL(lote_cantidad_actual) AS units,
      TOTAL(lote_cantidad_actual * lote_precio_costo) AS value,
      COUNT(CASE WHEN NOT (${integerExpression(sql`lote_cantidad_actual`)})
        OR NOT (${integerExpression(sql`lote_precio_costo`)}) THEN 1 END) AS invalid
    FROM lote WHERE lote_cantidad_actual > 0
  `);
  if (totals.invalid > 0 || safeInteger(totals.units) < 0 ||
    safeInteger(totals.value) < 0) {
    throw new NumericRangeError("Las existencias o su valorización superan el rango permitido.");
  }
}

export async function assertDailySaleTotals(
  executor: SqlValidationExecutor,
  now: Date,
): Promise<void> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await executor.all<{ total: number; invalid: number }>(sql`
    WITH subtotals AS (
      SELECT v.venta_id, v.venta_estado, v.venta_descuento_tipo, v.venta_descuento_valor,
        TOTAL(d.detalle_venta_cantidad * h.historial_precio_venta) AS subtotal
      FROM venta v JOIN detalle_venta d ON d.venta_id = v.venta_id
      JOIN historial_precio_producto h ON h.historial_precio_producto_id = d.historial_precio_producto_id
      WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
        AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
      GROUP BY v.venta_id
    ) SELECT TOTAL(MAX(0, CASE venta_descuento_tipo
      WHEN 'monto' THEN subtotal - COALESCE(venta_descuento_valor, 0)
      WHEN 'porcentaje' THEN ROUND(subtotal * (1 - COALESCE(venta_descuento_valor, 0) / 100.0))
      ELSE subtotal END)) AS total,
      COUNT(CASE WHEN subtotal > ${Number.MAX_SAFE_INTEGER} THEN 1 END) AS invalid
    FROM subtotals GROUP BY venta_estado
  `);
  for (const row of rows) {
    if (row.invalid || safeInteger(row.total) < 0) {
      throw new NumericRangeError("Los totales del día superan el rango permitido.");
    }
  }
}

export const validEanExpression = (ean13: string) => sql<number>`
  CASE WHEN
    typeof(${ean13}) = 'text'
    AND length(trim(${ean13})) = 13
    AND trim(${ean13}) NOT GLOB '*[^0-9]*'
    AND (
      CAST(substr(trim(${ean13}), 1, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 2, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 3, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 4, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 5, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 6, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 7, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 8, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 9, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 10, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 11, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 12, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 13, 1) AS INTEGER)
    ) % 10 = 0
  THEN 1 ELSE 0 END
`;
