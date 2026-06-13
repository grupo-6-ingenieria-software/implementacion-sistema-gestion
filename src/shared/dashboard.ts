export const DASHBOARD_UPDATED_EVENT = 'dashboard:actualizado';

export type DashboardRequest =
  | {
      role: 'dueno';
      usuarioId?: string;
    }
  | {
      role: 'trabajador';
      usuarioId: string;
    };

export function isDashboardRequest(
  payload: unknown,
): payload is DashboardRequest {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const request = payload as { role?: unknown; usuarioId?: unknown };

  if (request.role === 'dueno') {
    return (
      request.usuarioId === undefined || typeof request.usuarioId === 'string'
    );
  }

  return (
    request.role === 'trabajador' &&
    typeof request.usuarioId === 'string' &&
    request.usuarioId.trim().length > 0
  );
}

export type StockAlert = {
  productName: string;
  ean13: string;
  categoryName: string;
  currentStock: number;
  minimumStock: number;
};

export type ExpirationAlert = {
  lotId: string;
  productName: string;
  ean13: string;
  availableQuantity: number;
  expirationDate: string;
  daysRemaining: number;
};

export type ExpirationAlerts = {
  expiringSoon: ExpirationAlert[];
  expired: ExpirationAlert[];
};

export type DailySalesSummary = {
  currentAmount: number;
  currentTransactions: number;
  voidedAmount: number;
  voidedTransactions: number;
};

export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia';

export type PaymentMethodSummary = {
  currentAmount: number;
  currentTransactions: number;
  voidedAmount: number;
  voidedTransactions: number;
};

export type CashSummary = DailySalesSummary & {
  status: 'abierta' | 'cerrada' | 'sin_registro';
  openedAt?: string;
  closedAt?: string;
  byPaymentMethod: Record<PaymentMethod, PaymentMethodSummary>;
};

export type AttendancePendingWorker = {
  workerId: number;
  fullName: string;
};

export type AttendanceSummary = {
  activeWorkers: number;
  workersWithAttendance: number;
  workersWithoutAttendance: number;
  pendingWorkers: AttendancePendingWorker[];
};

export type DashboardData = {
  generatedAt: string;
  sales: DailySalesSummary;
  cashSummary: CashSummary;
  stockAlerts: StockAlert[];
  expirationAlerts: ExpirationAlerts;
  attendance: AttendanceSummary;
};
