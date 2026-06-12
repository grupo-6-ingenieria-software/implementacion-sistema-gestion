export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia';

export type SaleLineForTotals = {
  cantidad: number;
  precioUnitario: number;
};

export type SaleTotals = {
  subtotal: number;
  descuento: number;
  total: number;
};

export function calculateSaleTotals(
  lines: readonly SaleLineForTotals[],
  descuento = 0,
): SaleTotals {
  const subtotal = lines.reduce(
    (total, line) => total + line.cantidad * line.precioUnitario,
    0,
  );
  const normalizedDiscount = Math.max(0, Math.min(descuento, subtotal));

  return {
    subtotal,
    descuento: normalizedDiscount,
    total: subtotal - normalizedDiscount,
  };
}

export function calculateCashChange(total: number, montoRecibido: number): number {
  return Math.max(0, montoRecibido - total);
}

export function isElectronicPayment(method: PaymentMethod): boolean {
  return method === 'debito' || method === 'credito' || method === 'transferencia';
}
