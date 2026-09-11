import { sql, type SQL } from "drizzle-orm";
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
} from "../../shared/dashboard";
import { differenceInCalendarDays, getDashboardDay } from "./dashboard-date";
import { calculateRecordedSaleTotal } from "../../shared/sales";
import { inspectDailyCashRegister } from "./cash-check";

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
  state: "completada" | "anulada";
  paymentMethod?: PaymentMethod;
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
  subtotal: number;
};

type CashRegisterRow = {
  status: "abierto" | "cerrado";
  openedAt: string;
  closedAt: string | null;
};

type AttendanceRow = {
  workerId: number;
  fullName: string;
  hasAttendance: number;
};

export async function loadStockAlerts(
  database: DashboardDb,
): Promise<StockAlert[]> {
  const products = await database.all<{
    productId: number;
    productName: string;
    ean13: string;
    categoryId: number;
    minimumStock: number;
  }>(sql`
    SELECT producto_id AS productId, producto_nombre AS productName, producto_ean_13 AS ean13,
      categoria_id AS categoryId, producto_stock_minimo AS minimumStock FROM producto WHERE producto_estado = 'activo'
  `);
  const categories = await database.all<{
    categoryId: number;
    categoryName: string;
  }>(sql`
    SELECT categoria_id AS categoryId, categoria_nombre AS categoryName FROM categoria
  `);
  const stocks = await database.all<{
    productId: number;
    currentStock: number;
  }>(sql`
    SELECT producto_id AS productId, SUM(lote_cantidad_actual) AS currentStock FROM lote GROUP BY producto_id
  `);
  const stockById = new Map(
    stocks.map((row) => [row.productId, Number(row.currentStock)]),
  );
  const categoryById = new Map(
    categories.map((row) => [row.categoryId, row.categoryName]),
  );
  return products
    .map((row) => ({
      productName: row.productName,
      ean13: row.ean13,
      categoryName: categoryById.get(row.categoryId) ?? "",
      minimumStock: Number(row.minimumStock),
      currentStock: stockById.get(row.productId) ?? 0,
    }))
    .filter((row) => row.currentStock <= row.minimumStock)
    .sort(
      (a, b) =>
        a.currentStock - b.currentStock ||
        a.productName.localeCompare(b.productName),
    );
}

export async function loadExpirationAlerts(
  database: DashboardDb,
  now = new Date(),
): Promise<ExpirationAlerts> {
  const { dateKey } = getDashboardDay(now);
  const lots = await database.all<{
    lotId: string;
    productId: number;
    availableQuantity: number;
  }>(sql`
    SELECT lote_id AS lotId, producto_id AS productId, lote_cantidad_actual AS availableQuantity
    FROM lote WHERE lote_cantidad_actual > 0
  `);
  const dates = await database.all<{
    lotId: string;
    expirationDate: string;
  }>(sql`
    SELECT lote_id AS lotId, lote_perecible_fecha_vencimiento AS expirationDate FROM lote_perecible
    WHERE date(lote_perecible_fecha_vencimiento) <= date(${dateKey}, '+7 days')
  `);
  const products = await database.all<{
    productId: number;
    productName: string;
    ean13: string;
  }>(sql`
    SELECT producto_id AS productId, producto_nombre AS productName, producto_ean_13 AS ean13
    FROM producto WHERE producto_estado = 'activo'
  `);
  const byProduct = new Map(products.map((row) => [row.productId, row]));
  const byDate = new Map(dates.map((row) => [row.lotId, row.expirationDate]));
  const alerts: ExpirationAlert[] = [];
  for (const lot of lots) {
    const product = byProduct.get(lot.productId);
    const expirationDate = byDate.get(lot.lotId);
    if (!product || !expirationDate) continue;
    const daysRemaining = differenceInCalendarDays(expirationDate, dateKey);
    alerts.push({
      lotId: lot.lotId,
      productName: product.productName,
      ean13: product.ean13,
      availableQuantity: Number(lot.availableQuantity),
      expirationDate,
      daysRemaining,
    });
  }
  alerts.sort(
    (a, b) =>
      a.daysRemaining - b.daysRemaining ||
      a.productName.localeCompare(b.productName),
  );
  return {
    expired: alerts.filter((row) => row.daysRemaining < 0),
    expiringSoon: alerts.filter((row) => row.daysRemaining >= 0),
  };
}

export async function loadDailySalesSummary(
  database: DashboardDb,
  now = new Date(),
): Promise<DailySalesSummary> {
  return summarizeDailySales(await loadDailySaleRows(database, now));
}

export async function loadDailySaleRows(
  database: DashboardDb,
  now = new Date(),
): Promise<SaleRow[]> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const sales = await database.all<
    Omit<SaleRow, "subtotal"> & { saleId: string }
  >(sql`
    SELECT venta_id AS saleId, venta_estado AS state, venta_metodo_pago AS paymentMethod,
      venta_descuento_tipo AS discountType, venta_descuento_valor AS discountValue
    FROM venta WHERE datetime(venta_fecha_hora) >= datetime(${startUtc}) AND datetime(venta_fecha_hora) < datetime(${endUtc})
  `);
  if (!sales.length) return [];
  const ids = sql.join(
    sales.map((row) => sql`${row.saleId}`),
    sql`, `,
  );
  const details = await database.all<{
    saleId: string;
    quantity: number;
    priceId: string;
  }>(sql`
    SELECT venta_id AS saleId, detalle_venta_cantidad AS quantity, historial_precio_producto_id AS priceId
    FROM detalle_venta WHERE venta_id IN (${ids})
  `);
  const prices = details.length
    ? await database.all<{ priceId: string; price: number }>(sql`
    SELECT historial_precio_producto_id AS priceId, historial_precio_venta AS price FROM historial_precio_producto
    WHERE historial_precio_producto_id IN (${sql.join(
      details.map((row) => sql`${row.priceId}`),
      sql`, `,
    )})
  `)
    : [];
  const byPrice = new Map(
    prices.map((row) => [row.priceId, Number(row.price)]),
  );
  const subtotals = new Map<string, number>();
  for (const detail of details)
    subtotals.set(
      detail.saleId,
      (subtotals.get(detail.saleId) ?? 0) +
        Number(detail.quantity) * (byPrice.get(detail.priceId) ?? 0),
    );
  return sales.map(({ saleId, ...sale }) => ({
    ...sale,
    subtotal: subtotals.get(saleId) ?? 0,
  }));
}

export function summarizeDailySales(rows: SaleRow[]): DailySalesSummary {
  return rows.reduce<DailySalesSummary>(
    (summary, row) => {
      const amount = calculateSaleAmount(row);

      if (row.state === "anulada") {
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
  const saleRows = await loadDailySaleRows(database, now);
  const cashRegister = await loadDailyCashRegister(database, now);
  return buildCashSummary(
    cashRegister,
    saleRows,
    summarizeDailySales(saleRows),
  );
}

export async function loadDailyCashRegister(
  database: DashboardDb,
  now = new Date(),
): Promise<CashRegisterRow | undefined> {
  const state = await inspectDailyCashRegister(database, now);
  if (state.status === "sin_registro") return undefined;
  return {
    status: state.status === "abierta" ? "abierto" : "cerrado",
    openedAt: state.openedAt,
    closedAt: state.status === "cerrada" ? state.closedAt : null,
  };
}

export function buildCashSummary(
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

    if (row.state === "anulada") {
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
      ? cashRegister.status === "abierto"
        ? "abierta"
        : "cerrada"
      : "sin_registro",
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
): Promise<AttendanceSummary> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const workers = await database.all<{
    workerId: number;
    fullName: string;
  }>(sql`
    SELECT trabajador_id AS workerId, trim(trabajador_nombre || ' ' || trabajador_apellido) AS fullName
    FROM trabajador WHERE trabajador_estado = 'activo' ORDER BY trabajador_apellido, trabajador_nombre
  `);
  const entries = await database.all<{ workerId: number }>(sql`
    SELECT DISTINCT trabajador_id AS workerId FROM asistencia
    WHERE datetime(asistencia_fecha_hora_entrada) >= datetime(${startUtc})
      AND datetime(asistencia_fecha_hora_entrada) < datetime(${endUtc})
  `);
  const present = new Set(entries.map((row) => Number(row.workerId)));
  const pendingWorkers = workers
    .filter((row) => !present.has(Number(row.workerId)))
    .map((row) => ({ workerId: Number(row.workerId), fullName: row.fullName }));
  return {
    activeWorkers: workers.length,
    workersWithAttendance: workers.length - pendingWorkers.length,
    workersWithoutAttendance: pendingWorkers.length,
    pendingWorkers,
  };
}

export function calculateSaleAmount(row: SaleRow): number {
  return calculateRecordedSaleTotal(row);
}
