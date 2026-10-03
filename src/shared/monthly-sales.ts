import type { PaymentMethod } from "./sales";

export const MONTHLY_SALES_EMPTY_MESSAGE = "No se encontraron ventas para el período indicado";
export { REPORT_EXPORT_ERROR_MESSAGE, isReportExportRequest } from "./reports";
export type { ReportExportResult } from "./reports";
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

export function monthlySalesChartImage(dias: readonly MonthlySalesDay[]): string {
  const width = 1000;
  const height = 300;
  const maximum = Math.max(1, ...dias.map((day) => day.monto));
  const step = 880 / Math.max(1, dias.length);
  const bars = dias.map((day, index) => {
    const x = 95 + index * step;
    const barHeight = day.monto / maximum * 225;
    return `<rect x="${x}" y="${250 - barHeight}" width="${step * 0.7}" height="${barHeight}" fill="#2d6a4f"/><text x="${x + step * 0.35}" y="270" text-anchor="middle">${index + 1}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="12" fill="#17202a"><text x="8" y="22">Monto CLP</text><text x="8" y="42">${maximum}</text><text x="65" y="250">0</text><line x1="90" y1="250" x2="985" y2="250" stroke="#9ba9b5"/>${bars}<text x="500" y="295" text-anchor="middle">Día del mes</text></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
