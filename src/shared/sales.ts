import type { Role } from "./navigation";

export type PaymentMethod = "efectivo" | "debito" | "credito" | "transferencia";

export type SaleResponsibleSnapshot = {
  usuarioId: string;
  nombre: string;
  rol: Role;
};

export type DailyCashState =
  | { status: "sin_registro" }
  | { status: "abierta"; cierreCajaId: string; openedAt: string }
  | {
      status: "cerrada";
      cierreCajaId: string;
      openedAt: string;
      closedAt: string;
      closedByUserId?: string;
      closedByName?: string;
    };

export type SaleCartItemInput = {
  productoId: number;
  ean13?: string;
  cantidad: number;
};

export type SaleCartValidationRequest = {
  items: SaleCartItemInput[];
};

export type SaleCartValidationLine = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  cantidad: number;
  precioUnitario: number;
  stockDisponible: number;
  subtotal: number;
};

export type SaleCartValidationResult = {
  lines: SaleCartValidationLine[];
  subtotal: number;
};

export type SaleDiscountInput = { monto: number; razon: string };

export type SaleRegisterRequest = {
  items: SaleCartItemInput[];
  metodoPago: PaymentMethod;
  montoRecibido?: number;
  descuento?: SaleDiscountInput;
};

export type SaleConsumedLot = {
  loteId: string;
  cantidad: number;
};

export type SaleReceiptLine = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  precioUnitario: number;
  historialPrecioProductoId: string;
  stockDisponible: number;
  exigeVencimiento: boolean;
  cantidad: number;
  subtotal: number;
  lotesConsumidos: SaleConsumedLot[];
};

export type SaleReceipt = {
  ventaId: string;
  fechaHora: string;
  responsable: SaleResponsibleSnapshot;
  metodoPago: PaymentMethod;
  subtotal: number;
  descuento: {
    tipo: "ninguno" | "monto";
    valor: number;
    razon?: string;
  };
  total: number;
  montoRecibido?: number;
  vuelto?: number;
  detalle: SaleReceiptLine[];
};

export type SaleState = "confirmada" | "anulada";

export type SaleSearchRequest = {
  ventaId: string;
  usuarioId?: string;
};

export type SaleSearchResult = {
  ventaId: string;
};

export type SaleHistorySearchRequest =
  | {
      criterio: "rango";
      fechaInicio: string;
      fechaTermino: string;
      usuarioId?: string;
    }
  | {
      criterio: "numero";
      ventaId: string;
      usuarioId?: string;
    };

export type SaleHistoryListItem = {
  ventaId: string;
  fechaHora: string;
  responsable: SaleResponsibleSnapshot;
  total: number;
  metodoPago: PaymentMethod;
  estado: SaleState;
  puedeAnular: boolean;
};

export type SaleHistorySearchSummary = {
  ventasVigentes: number;
  montoVigente: number;
  ventasAnuladas: number;
};

export type SaleHistorySearchResult = {
  ventas: SaleHistoryListItem[];
  resumen: SaleHistorySearchSummary;
};

export type SaleDetailLine = {
  productoId: number;
  ean13: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
};

export type SaleDetail = {
  ventaId: string;
  fechaHora: string;
  estado: SaleState;
  responsable: SaleResponsibleSnapshot;
  productos: SaleDetailLine[];
  descuento: {
    tipo: "ninguno" | "porcentaje" | "monto";
    valor: number;
    razon?: string;
  };
  pago: {
    metodo: PaymentMethod;
    montoRecibido?: number;
    vuelto?: number;
  };
  subtotal: number;
  total: number;
  caja: {
    cierreCajaId: string;
    estado: "abierta" | "cerrada";
    fechaApertura: string;
    fechaCierre?: string;
  };
};

export type SaleAnnulmentRequest = SaleSearchRequest & {
  razon: string;
};

export type SaleAnnulmentResult = {
  ventaId: string;
  fechaHora: string;
  razon: string;
  responsable: {
    usuarioId: string;
    nombre: string;
  };
  lotesRestituidos: number;
  unidadesRestituidas: number;
};

export const SALE_ANNULLED_EVENT = "venta:anulada";

/** CU38: el numero visible de venta es el UUID completo ya persistido. */
export function isValidSaleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  );
}

export function isValidSaleHistoryDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function getChileDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export type SaleLineForTotals = {
  cantidad: number;
  precioUnitario: number;
};

export type SaleTotals = {
  subtotal: number;
  descuento: number;
  total: number;
};

export type SaleDiscountErrors = { monto?: string; razon?: string };

/** CU37: CLP enteros, con o sin agrupación chilena de miles. */
export function parseSaleDiscountAmount(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) return null;
  const amount = Number(text.replaceAll(".", ""));
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function validateSaleDiscount(
  monto: unknown,
  razon: unknown,
  subtotal: number,
): SaleDiscountErrors {
  const errors: SaleDiscountErrors = {};
  const amountError = getSaleDiscountAmountError(monto, subtotal);
  if (amountError) errors.monto = amountError;
  if (
    typeof monto === "number" &&
    monto > 0 &&
    (typeof razon !== "string" || !razon.trim())
  ) {
    errors.razon =
      "La razón del descuento es obligatoria cuando se aplica un descuento.";
  }
  return errors;
}

function getSaleDiscountAmountError(
  monto: unknown,
  subtotal: number,
): string | undefined {
  if (typeof monto !== "number" || !Number.isSafeInteger(monto) || monto < 0) {
    return "El descuento debe ser un monto entero mayor o igual a cero.";
  }
  if (monto > subtotal) {
    return "El descuento no puede ser mayor al subtotal de la venta.";
  }
  return undefined;
}

export type RecordedSaleTotalsInput = {
  subtotal: number;
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
};

export type DailySale = {
  ventaId: string;
  fechaHora: string;
  responsable: SaleResponsibleSnapshot;
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

const chileanPesoFormatter = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 0,
});

export function formatChileanPeso(value: number): string {
  return `$ ${chileanPesoFormatter.format(value)}`;
}

export function formatSaleResponsibleRole(role: Role): string {
  return role === "dueno" ? "Dueño" : "Trabajador";
}

export function calculateSaleTotals(
  lines: readonly SaleLineForTotals[],
  descuento = 0,
): SaleTotals {
  const subtotal = lines.reduce(
    (total, line) => total + line.cantidad * line.precioUnitario,
    0,
  );
  const error = getSaleDiscountAmountError(descuento, subtotal);
  if (error) throw new RangeError(error);

  return {
    subtotal,
    descuento,
    total: subtotal - descuento,
  };
}

export function calculateRecordedSaleTotal(
  sale: RecordedSaleTotalsInput,
): number {
  const subtotal = Number(sale.subtotal);
  const discount = Number(sale.discountValue ?? 0);

  if (sale.discountType === "porcentaje") {
    return Math.max(0, Math.round(subtotal * (1 - discount / 100)));
  }

  if (sale.discountType === "monto") {
    return Math.max(0, subtotal - discount);
  }

  return subtotal;
}

export function calculateCashChange(
  total: number,
  montoRecibido: number,
): number {
  return Math.max(0, montoRecibido - total);
}

export function isElectronicPayment(method: PaymentMethod): boolean {
  return (
    method === "debito" || method === "credito" || method === "transferencia"
  );
}
