import type { Role } from './navigation';

export const DASHBOARD_UPDATED_EVENT = 'dashboard:actualizado';

export type DashboardRequest = {
  role: Role;
  usuarioId?: string;
};

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
