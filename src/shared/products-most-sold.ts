import { isValidSaleHistoryDate } from "./sales";

export const PRODUCTS_MOST_SOLD_REPORT_TYPE = "productos-mas-vendidos";
export const PRODUCTS_MOST_SOLD_EMPTY_MESSAGE = "No se encontraron productos vendidos para el período indicado";
export const PRODUCTS_MOST_SOLD_QUERY_ERROR_MESSAGE = "No fue posible consultar los productos más vendidos. Intente nuevamente.";

export type ProductsMostSoldPeriod = { fechaInicio: string; fechaTermino: string };
export type ProductsMostSoldRow = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  unidadesVendidas: number;
  ingresoNeto: number;
  porcentajeUnidades: number;
};
export type ProductsMostSoldReport = {
  status: "ready" | "empty";
  periodo: ProductsMostSoldPeriod;
  totalUnidadesPeriodo: number;
  filas: ProductsMostSoldRow[];
};
export type ProductsMostSoldExportRequest = {
  tipo: typeof PRODUCTS_MOST_SOLD_REPORT_TYPE;
  periodo: ProductsMostSoldPeriod;
};

export function parseProductsMostSoldPeriod(payload: unknown): ProductsMostSoldPeriod {
  const value = payload as Partial<ProductsMostSoldPeriod> | null;
  if (!value || !isValidSaleHistoryDate(value.fechaInicio) || !isValidSaleHistoryDate(value.fechaTermino)) {
    throw new RangeError("Ingrese fechas válidas en formato DD/MM/AAAA.");
  }
  if (value.fechaInicio > value.fechaTermino) {
    throw new RangeError("La fecha de inicio no puede ser posterior a la fecha de término");
  }
  return { fechaInicio: value.fechaInicio, fechaTermino: value.fechaTermino };
}

export function parseProductsMostSoldDisplayDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidSaleHistoryDate(iso) ? iso : null;
}

export function formatProductsMostSoldDisplayDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function formatProductsMostSoldPercentage(value: number): string {
  return `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} %`;
}
