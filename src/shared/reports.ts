import type { PaymentMethod, SaleResponsibleSnapshot, SaleState } from "./sales";

export const DAILY_SALES_EMPTY_MESSAGE = "Sin ventas en la fecha seleccionada";
export const REPORT_EXPORT_ERROR_MESSAGE = "No fue posible generar el archivo";

export type DailySalesReportRequest = { fecha: string };

export type DailySalesReportSale = {
  ventaId: string;
  fechaHora: string;
  responsable: SaleResponsibleSnapshot;
  estado: SaleState;
  metodoPago: PaymentMethod;
  total: number;
};

export type DailySalesReportTopProduct = {
  productoId: number;
  ean13: string;
  nombre: string;
  unidades: number;
  montoNeto: number;
};

export type DailySalesReport = {
  fecha: string;
  tieneVentas: boolean;
  ventas: DailySalesReportSale[];
  resumen: {
    ventasVigentes: number;
    montoVigente: number;
    porMetodoPago: Record<PaymentMethod, { cantidad: number; monto: number }>;
    ventasAnuladas: number;
    montoAnulado: number;
  };
  topProductos: DailySalesReportTopProduct[];
  caja: { estado: "abierta" | "cerrada" | "sin_registro"; fechaHoraCierre?: string };
};

export type DailySalesExportRequest = DailySalesReportRequest & {
  tipo: "ventas-diarias";
};

export type DailySalesExportResult = {
  formato: "pdf" | "xlsx";
  estado: "saved" | "cancelled";
  ruta?: string;
};
