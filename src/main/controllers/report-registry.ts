import {
  MONTHLY_SALES_REPORT_TYPE, monthlyPeriodKey, monthlyPeriodLabel, parseMonthlySalesPeriod,
} from "../../shared/monthly-sales";
import type { ReportExportRequest, ReportHeader } from "../../shared/reports";
import type { ControllerContext } from "./base";
import { loadAuthorizedMonthlySales } from "./monthly-sales";
import { createMonthlySalesPdf, createMonthlySalesXlsx } from "./monthly-sales-export";

export type PreparedReport = {
  hasData: boolean;
  cantidadFilas: number;
  usuario: string;
  tipoEtiqueta: string;
  periodoEtiqueta: string;
  tipoArchivo: string;
  periodoArchivo: string;
  pdf: (header: ReportHeader) => Promise<Buffer>;
  xlsx: (header: ReportHeader) => Promise<Buffer>;
};
export type ReportAdapter = {
  tipo: string;
  normalize: (request: ReportExportRequest) => ReportExportRequest;
  load: (request: ReportExportRequest, context: ControllerContext) => Promise<PreparedReport>;
};

export class ReportNotAvailableError extends Error {}

// These are documented report identities, not implementations of their producers.
const documentedReports = new Set([
  "ventas-diarias", "ventas-mensuales", "productos-mas-vendidos", "mermas",
  "lotes-por-vencer", "rentabilidad-categoria", "asistencia", "movimientos-inventario",
]);

export function createReportRegistry(adapters: readonly ReportAdapter[]): ReadonlyMap<string, ReportAdapter> {
  const registry = new Map<string, ReportAdapter>();
  for (const adapter of adapters) {
    if (registry.has(adapter.tipo)) throw new Error("DuplicateReportAdapter");
    registry.set(adapter.tipo, adapter);
  }
  return registry;
}

export function findReportAdapter(registry: ReadonlyMap<string, ReportAdapter>, tipo: string): ReportAdapter {
  const adapter = registry.get(tipo);
  if (adapter) return adapter;
  if (documentedReports.has(tipo)) throw new ReportNotAvailableError();
  throw new RangeError("Tipo de reporte no válido.");
}

export function createMonthlySalesReportAdapter(
  load = loadAuthorizedMonthlySales,
  pdf = createMonthlySalesPdf,
  xlsx = createMonthlySalesXlsx,
): ReportAdapter {
  return {
    tipo: MONTHLY_SALES_REPORT_TYPE,
    normalize: (request) => {
      if (request.filtros !== undefined && request.filtros !== null &&
        (typeof request.filtros !== "object" || Array.isArray(request.filtros) || Object.keys(request.filtros).length > 0))
        throw new RangeError("El reporte mensual no admite filtros adicionales.");
      return { tipo: MONTHLY_SALES_REPORT_TYPE, periodo: parseMonthlySalesPeriod(request.periodo) };
    },
    load: async (request, context) => {
      const period = parseMonthlySalesPeriod(request.periodo);
      const { report, user } = await load(period, context);
      return {
        hasData: report.transacciones > 0, cantidadFilas: report.dias.length,
        usuario: user.trabajadorNombre, tipoEtiqueta: "Reporte mensual de ventas",
        periodoEtiqueta: monthlyPeriodLabel(period), tipoArchivo: "VentasMensuales", periodoArchivo: monthlyPeriodKey(period),
        pdf: (header) => pdf({ report, usuario: header.usuario, fecha: header.fecha, header }),
        xlsx: (header) => xlsx({ report, usuario: header.usuario, fecha: header.fecha, header }),
      };
    },
  };
}

export const reportRegistry = createReportRegistry([createMonthlySalesReportAdapter()]);
