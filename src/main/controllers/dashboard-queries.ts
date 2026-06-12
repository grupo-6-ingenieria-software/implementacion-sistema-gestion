import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type {
  AttendanceSummary,
  DailySalesSummary,
  ExpirationAlert,
  ExpirationAlerts,
  StockAlert,
} from '../../shared/dashboard';
import {
  differenceInCalendarDays,
  getDashboardDay,
} from './dashboard-date';

type StockAlertRow = {
  productName: string;
  ean13: string;
  categoryName: string;
  currentStock: number;
  minimumStock: number;
};

type ExpirationAlertRow = {
  lotId: string;
  productName: string;
  ean13: string;
  availableQuantity: number;
  expirationDate: string;
};

type SaleRow = {
  state: 'completada' | 'anulada';
  discountType: 'ninguno' | 'porcentaje' | 'monto';
  discountValue: number | null;
  subtotal: number;
};

type AttendanceRow = {
  workerId: number;
  fullName: string;
  hasAttendance: number;
};

export async function loadStockAlerts(): Promise<StockAlert[]> {
  const rows = await db.all<StockAlertRow>(sql`
    SELECT
      p.producto_nombre AS productName,
      p.producto_ean_13 AS ean13,
      c.categoria_nombre AS categoryName,
      COALESCE(SUM(l.lote_cantidad_actual), 0) AS currentStock,
      p.producto_stock_minimo AS minimumStock
    FROM producto p
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN lote l ON l.producto_id = p.producto_id
    WHERE p.producto_estado = 'activo'
    GROUP BY
      p.producto_id,
      p.producto_nombre,
      p.producto_ean_13,
      c.categoria_nombre,
      p.producto_stock_minimo
    HAVING COALESCE(SUM(l.lote_cantidad_actual), 0) <= p.producto_stock_minimo
    ORDER BY currentStock ASC, p.producto_nombre ASC
  `);

  return rows.map((row) => ({
    ...row,
    currentStock: Number(row.currentStock),
    minimumStock: Number(row.minimumStock),
  }));
}

export async function loadExpirationAlerts(
  now = new Date(),
): Promise<ExpirationAlerts> {
  const { dateKey } = getDashboardDay(now);
  const rows = await db.all<ExpirationAlertRow>(sql`
    SELECT
      l.lote_id AS lotId,
      p.producto_nombre AS productName,
      p.producto_ean_13 AS ean13,
      l.lote_cantidad_actual AS availableQuantity,
      lp.lote_perecible_fecha_vencimiento AS expirationDate
    FROM lote l
    INNER JOIN lote_perecible lp ON lp.lote_id = l.lote_id
    INNER JOIN producto p ON p.producto_id = l.producto_id
    WHERE
      p.producto_estado = 'activo'
      AND l.lote_cantidad_actual > 0
      AND date(lp.lote_perecible_fecha_vencimiento) <= date(${dateKey}, '+7 days')
    ORDER BY date(lp.lote_perecible_fecha_vencimiento) ASC, p.producto_nombre ASC
  `);

  const alerts = rows.map<ExpirationAlert>((row) => ({
    ...row,
    availableQuantity: Number(row.availableQuantity),
    daysRemaining: differenceInCalendarDays(row.expirationDate, dateKey),
  }));

  return {
    expired: alerts.filter((alert) => alert.daysRemaining < 0),
    expiringSoon: alerts.filter((alert) => alert.daysRemaining >= 0),
  };
}

export async function loadDailySalesSummary(
  now = new Date(),
): Promise<DailySalesSummary> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await db.all<SaleRow>(sql`
    SELECT
      v.venta_estado AS state,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue,
      COALESCE(
        SUM(dv.detalle_venta_cantidad * hp.historial_precio_venta),
        0
      ) AS subtotal
    FROM venta v
    LEFT JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    LEFT JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE
      datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    GROUP BY
      v.venta_id,
      v.venta_estado,
      v.venta_descuento_tipo,
      v.venta_descuento_valor
  `);

  return rows.reduce<DailySalesSummary>(
    (summary, row) => {
      const amount = calculateSaleAmount(row);

      if (row.state === 'anulada') {
        summary.voidedAmount += amount;
        summary.voidedTransactions += 1;
      } else {
        summary.currentAmount += amount;
        summary.currentTransactions += 1;
      }

      return summary;
    },
    {
      currentAmount: 0,
      currentTransactions: 0,
      voidedAmount: 0,
      voidedTransactions: 0,
    },
  );
}

export async function loadAttendanceSummary(
  now = new Date(),
): Promise<AttendanceSummary> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await db.all<AttendanceRow>(sql`
    SELECT
      t.trabajador_id AS workerId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS fullName,
      CASE WHEN EXISTS (
        SELECT 1
        FROM asistencia a
        WHERE
          a.trabajador_id = t.trabajador_id
          AND datetime(a.asistencia_fecha_hora_entrada) >= datetime(${startUtc})
          AND datetime(a.asistencia_fecha_hora_entrada) < datetime(${endUtc})
      ) THEN 1 ELSE 0 END AS hasAttendance
    FROM trabajador t
    WHERE t.trabajador_estado = 'activo'
    ORDER BY t.trabajador_apellido ASC, t.trabajador_nombre ASC
  `);
  const pendingWorkers = rows
    .filter((row) => Number(row.hasAttendance) === 0)
    .map((row) => ({
      workerId: Number(row.workerId),
      fullName: row.fullName,
    }));

  return {
    activeWorkers: rows.length,
    workersWithAttendance: rows.length - pendingWorkers.length,
    workersWithoutAttendance: pendingWorkers.length,
    pendingWorkers,
  };
}

export function calculateSaleAmount(row: SaleRow): number {
  const subtotal = Number(row.subtotal);
  const discount = Number(row.discountValue ?? 0);

  if (row.discountType === 'porcentaje') {
    return Math.max(0, Math.round(subtotal * (1 - discount / 100)));
  }

  if (row.discountType === 'monto') {
    return Math.max(0, subtotal - discount);
  }

  return subtotal;
}
