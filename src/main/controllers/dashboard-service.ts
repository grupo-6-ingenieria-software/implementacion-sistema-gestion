import { sql, type SQL } from 'drizzle-orm';
import type {
  AttendanceSummary,
  CashSummary,
  DailySalesSummary,
  DashboardData,
  DashboardRequest,
  ExpirationAlert,
  ExpirationAlerts,
  PaymentMethod,
  PaymentMethodSummary,
  StockAlert,
} from '../../shared/dashboard';
import {
  differenceInCalendarDays,
  getDashboardDay,
} from './dashboard-date';

export type DashboardDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
};

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

export type SaleRow = {
  state: 'completada' | 'anulada';
  paymentMethod?: PaymentMethod;
  discountType: 'ninguno' | 'porcentaje' | 'monto';
  discountValue: number | null;
  subtotal: number;
};

type CashRegisterRow = {
  status: 'abierto' | 'cerrado';
  openedAt: string;
  closedAt: string | null;
};

type AttendanceRow = {
  workerId: number;
  fullName: string;
  hasAttendance: number;
};

export async function loadDashboardData(
  database: DashboardDb,
  request: DashboardRequest,
  now = new Date(),
): Promise<DashboardData> {
  const [saleRows, cashRegister, stockAlerts, expirationAlerts, attendance] =
    await Promise.all([
      loadDailySaleRows(database, now),
      loadDailyCashRegister(database, now),
      loadStockAlerts(database),
      loadExpirationAlerts(database, now),
      loadAttendanceSummary(database, now, request),
    ]);

  const sales = summarizeDailySales(saleRows);

  return {
    generatedAt: now.toISOString(),
    sales,
    cashSummary: buildCashSummary(cashRegister, saleRows, sales),
    stockAlerts,
    expirationAlerts,
    attendance,
  };
}

export async function loadStockAlerts(
  database: DashboardDb,
): Promise<StockAlert[]> {
  const rows = await database.all<StockAlertRow>(sql`
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
  database: DashboardDb,
  now = new Date(),
): Promise<ExpirationAlerts> {
  const { dateKey } = getDashboardDay(now);
  const rows = await database.all<ExpirationAlertRow>(sql`
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
  database: DashboardDb,
  now = new Date(),
): Promise<DailySalesSummary> {
  return summarizeDailySales(await loadDailySaleRows(database, now));
}

async function loadDailySaleRows(
  database: DashboardDb,
  now = new Date(),
): Promise<SaleRow[]> {
  const { startUtc, endUtc } = getDashboardDay(now);
  return database.all<SaleRow>(sql`
    SELECT
      v.venta_estado AS state,
      v.venta_metodo_pago AS paymentMethod,
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
      v.venta_metodo_pago,
      v.venta_descuento_tipo,
      v.venta_descuento_valor
  `);
}

export function summarizeDailySales(rows: SaleRow[]): DailySalesSummary {
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

export async function loadCashSummary(
  database: DashboardDb,
  now = new Date(),
): Promise<CashSummary> {
  const [saleRows, cashRegister] = await Promise.all([
    loadDailySaleRows(database, now),
    loadDailyCashRegister(database, now),
  ]);
  return buildCashSummary(cashRegister, saleRows, summarizeDailySales(saleRows));
}

async function loadDailyCashRegister(
  database: DashboardDb,
  now = new Date(),
): Promise<CashRegisterRow | undefined> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<CashRegisterRow>(sql`
    SELECT
      c.cierre_estado AS status,
      c.cierre_fecha_hora_inicio AS openedAt,
      c.cierre_fecha_hora_fin AS closedAt
    FROM cierre_caja c
    WHERE
      (
        datetime(c.cierre_fecha_hora_inicio) >= datetime(${startUtc})
        AND datetime(c.cierre_fecha_hora_inicio) < datetime(${endUtc})
      )
      OR (
        c.cierre_fecha_hora_fin IS NOT NULL
        AND datetime(c.cierre_fecha_hora_fin) >= datetime(${startUtc})
        AND datetime(c.cierre_fecha_hora_fin) < datetime(${endUtc})
      )
      OR EXISTS (
        SELECT 1
        FROM venta v
        WHERE
          v.cierre_caja_id = c.cierre_caja_id
          AND datetime(v.venta_fecha_hora) >= datetime(${startUtc})
          AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
      )
    ORDER BY
      CASE WHEN c.cierre_estado = 'abierto' THEN 0 ELSE 1 END,
      datetime(COALESCE(c.cierre_fecha_hora_fin, c.cierre_fecha_hora_inicio)) DESC
    LIMIT 1
  `);

  return rows[0];
}

function buildCashSummary(
  cashRegister: CashRegisterRow | undefined,
  saleRows: SaleRow[],
  sales: DailySalesSummary,
): CashSummary {
  const byPaymentMethod = createEmptyPaymentBreakdown();

  for (const row of saleRows) {
    if (!row.paymentMethod) {
      continue;
    }

    const methodSummary = byPaymentMethod[row.paymentMethod];
    const amount = calculateSaleAmount(row);

    if (row.state === 'anulada') {
      methodSummary.voidedAmount += amount;
      methodSummary.voidedTransactions += 1;
    } else {
      methodSummary.currentAmount += amount;
      methodSummary.currentTransactions += 1;
    }
  }

  return {
    ...sales,
    status: cashRegister
      ? cashRegister.status === 'abierto'
        ? 'abierta'
        : 'cerrada'
      : 'sin_registro',
    openedAt: cashRegister?.openedAt,
    closedAt: cashRegister?.closedAt ?? undefined,
    byPaymentMethod,
  };
}

function createEmptyPaymentBreakdown(): Record<
  PaymentMethod,
  PaymentMethodSummary
> {
  return {
    efectivo: createEmptyPaymentMethodSummary(),
    debito: createEmptyPaymentMethodSummary(),
    credito: createEmptyPaymentMethodSummary(),
    transferencia: createEmptyPaymentMethodSummary(),
  };
}

function createEmptyPaymentMethodSummary(): PaymentMethodSummary {
  return {
    currentAmount: 0,
    currentTransactions: 0,
    voidedAmount: 0,
    voidedTransactions: 0,
  };
}

export async function loadAttendanceSummary(
  database: DashboardDb,
  now = new Date(),
  request?: Pick<DashboardRequest, 'role' | 'usuarioId'>,
): Promise<AttendanceSummary> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const shouldFilterWorker =
    request?.role === 'trabajador' && Boolean(request.usuarioId);
  const usuarioId = request?.usuarioId ?? '';
  const rows = await database.all<AttendanceRow>(sql`
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
    WHERE
      t.trabajador_estado = 'activo'
      AND (
        ${shouldFilterWorker ? 1 : 0} = 0
        OR EXISTS (
          SELECT 1
          FROM usuario u
          WHERE
            u.trabajador_id = t.trabajador_id
            AND u.usuario_id = ${usuarioId}
        )
      )
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
