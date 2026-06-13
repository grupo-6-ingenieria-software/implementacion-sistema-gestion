import type { PaymentMethod } from './sales';

export type CashClosingStatus = 'abierta' | 'cerrada' | 'sin_registro';

export type CashClosingPaymentSummary = {
  currentAmount: number;
  currentTransactions: number;
  voidedAmount: number;
  voidedTransactions: number;
};

export type CashClosingTotals = {
  currentAmount: number;
  currentTransactions: number;
  voidedAmount: number;
  voidedTransactions: number;
};

export type CashClosingSummary = CashClosingTotals & {
  cierreCajaId?: string;
  closedAt?: string;
  closedBy?: {
    usuarioId: string;
    nombre?: string;
  };
  generatedAt: string;
  openedAt?: string;
  payments: Record<PaymentMethod, CashClosingPaymentSummary>;
  status: CashClosingStatus;
};

export type CashClosingRequest = {
  usuarioId?: string;
};

export type CashCloseRequest = CashClosingRequest & {
  confirmacion?: boolean;
};

export type CashCloseResult = CashClosingSummary & {
  closedAt: string;
  closedBy: {
    usuarioId: string;
    nombre?: string;
  };
};

export const cashPaymentMethods: readonly PaymentMethod[] = [
  'efectivo',
  'debito',
  'credito',
  'transferencia',
];

export const cashPaymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  debito: 'Debito',
  credito: 'Credito',
  transferencia: 'Transferencia',
};

export function createEmptyCashPaymentSummary(): CashClosingPaymentSummary {
  return {
    currentAmount: 0,
    currentTransactions: 0,
    voidedAmount: 0,
    voidedTransactions: 0,
  };
}

export function createEmptyCashPaymentBreakdown(): Record<
  PaymentMethod,
  CashClosingPaymentSummary
> {
  return {
    efectivo: createEmptyCashPaymentSummary(),
    debito: createEmptyCashPaymentSummary(),
    credito: createEmptyCashPaymentSummary(),
    transferencia: createEmptyCashPaymentSummary(),
  };
}
