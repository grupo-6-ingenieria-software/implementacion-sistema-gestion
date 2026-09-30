import type { PaymentMethod } from "./sales";

export const MONTHLY_SALES_EMPTY_MESSAGE = "No se encontraron ventas para el período indicado";
export const REPORT_EXPORT_ERROR_MESSAGE = "No fue posible generar el archivo";
export const MONTHLY_SALES_REPORT_TYPE = "ventas-mensuales";

export type MonthlySalesPeriod = { mes: number; anio: number };
export type MonthlySalesDay = { fecha: string; transacciones: number; monto: number };
export type MonthlySalesReport = {
  periodo: MonthlySalesPeriod;
  dias: MonthlySalesDay[];
  metodos: { metodo: PaymentMethod; transacciones: number; monto: number }[];
  transacciones: number;
  montoTotal: number;
  montoMesAnterior: number;
  variacionPorcentual: number | null;
};
export type MonthlySalesExportRequest = {
  tipo: typeof MONTHLY_SALES_REPORT_TYPE;
  periodo: MonthlySalesPeriod;
};
export type ReportExportResult = {
  formato: "pdf" | "xlsx";
  estado: "saved" | "cancelled";
  cantidadFilas: number;
  fechaGeneracion: string;
  ruta?: string;
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export function parseMonthlySalesPeriod(payload: unknown): MonthlySalesPeriod {
  const value = payload as Partial<MonthlySalesPeriod> | null;
  if (!value || !Number.isInteger(value.mes) || !Number.isInteger(value.anio) ||
      value.mes! < 1 || value.mes! > 12 || value.anio! < 1900 || value.anio! > 9998) {
    throw new RangeError("Seleccione un mes y un año válidos.");
  }
  return { mes: value.mes!, anio: value.anio! };
}

export function monthlyPeriodKey(period: MonthlySalesPeriod): string {
  return `${period.anio}-${String(period.mes).padStart(2, "0")}`;
}

export function monthlyPeriodLabel(period: MonthlySalesPeriod): string {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${monthlyPeriodKey(period)}-01T12:00:00Z`));
}

export function formatMonthlySalesMoney(value: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

export function formatMonthlyVariation(value: number | null): string {
  return value === null ? "N/A" : `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} %`;
}

export function isReportExportRequest(channel: string, payload: unknown): boolean {
  return (channel === "reporte:exportar-pdf" || channel === "reporte:exportar-xlsx") &&
    payload !== null && typeof payload === "object" && "tipo" in payload;
}
