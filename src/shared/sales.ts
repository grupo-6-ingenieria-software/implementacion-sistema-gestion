export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia';

export type SaleState = 'completada' | 'anulada';

export type SaleLineForTotals = {
  cantidad: number;
  precioUnitario: number;
};

export type SaleTotals = {
  subtotal: number;
  descuento: number;
  total: number;
};

export type RecordedSaleTotalsInput = {
  subtotal: number;
  discountType: 'ninguno' | 'porcentaje' | 'monto';
  discountValue: number | null;
};

export type DailySale = {
  ventaId: string;
  fechaHora: string;
  trabajadorResponsable: string;
  cantidadProductos: number;
  total: number;
  metodoPago: PaymentMethod;
  estado: SaleState;
};

export type DailyPaymentSummary = {
  cantidadVentas: number;
  monto: number;
};

export type DailySalesSummary = {
  ventasVigentes: number;
  montoVigente: number;
  porMetodoPago: Record<PaymentMethod, DailyPaymentSummary>;
  ventasAnuladas: number;
  montoAnulado: number;
};

export type DailySalesHistory = {
  ventas: DailySale[];
  resumen: DailySalesSummary;
};

const chileanPesoFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 0,
});

export function formatChileanPeso(value: number): string {
  return `$ ${chileanPesoFormatter.format(value)}`;
}

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

export function calculateRecordedSaleTotal(
  sale: RecordedSaleTotalsInput,
): number {
  const subtotal = Number(sale.subtotal);
  const discount = Number(sale.discountValue ?? 0);

  if (sale.discountType === 'porcentaje') {
    return Math.max(0, Math.round(subtotal * (1 - discount / 100)));
  }

  if (sale.discountType === 'monto') {
    return Math.max(0, subtotal - discount);
  }

  return subtotal;
}

export function calculateCashChange(total: number, montoRecibido: number): number {
  return Math.max(0, montoRecibido - total);
}

export function isElectronicPayment(method: PaymentMethod): boolean {
  return method === 'debito' || method === 'credito' || method === 'transferencia';
}
