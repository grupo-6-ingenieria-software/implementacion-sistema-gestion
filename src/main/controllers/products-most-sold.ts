import { sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  parseProductsMostSoldPeriod,
  PRODUCTS_MOST_SOLD_QUERY_ERROR_MESSAGE,
  type ProductsMostSoldPeriod,
  type ProductsMostSoldReport,
  type ProductsMostSoldRow,
} from "../../shared/products-most-sold";
import { allocateRecordedSaleNet, calculateRecordedSaleTotal } from "../../shared/sales";
import { AccessDeniedError, authorizeUser, type AuthenticatedUser } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerContext, type RegisteredController } from "./base";
import { getChileDateRange } from "./dashboard-date";

type SoldLine = {
  ventaId: string;
  detalleVentaId: string;
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  cantidad: number;
  precioUnitario: number;
  historialProductoId: number;
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
};
export type ProductsMostSoldExecutor = { all: <T>(query: SQL) => Promise<T[]> };
export type AuthorizedProductsMostSoldReport = { report: ProductsMostSoldReport; user: AuthenticatedUser };

function safeAdd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new RangeError("Los datos de venta son incoherentes.");
  return result;
}

export async function queryProductsMostSold(
  database: ProductsMostSoldExecutor,
  input: ProductsMostSoldPeriod,
): Promise<ProductsMostSoldReport> {
  const periodo = parseProductsMostSoldPeriod(input);
  const { startUtc, endUtc } = getChileDateRange(periodo.fechaInicio, periodo.fechaTermino);
  const lines = await database.all<SoldLine>(sql`
    SELECT v.venta_id AS ventaId, dv.detalle_venta_id AS detalleVentaId,
      p.producto_id AS productoId, p.producto_ean_13 AS ean13,
      p.producto_nombre AS nombre, c.categoria_nombre AS categoria,
      dv.detalle_venta_cantidad AS cantidad,
      hp.historial_precio_venta AS precioUnitario,
      hp.producto_id AS historialProductoId,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue
    FROM venta v
    INNER JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    INNER JOIN historial_precio_producto hp ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    INNER JOIN producto p ON p.producto_id = dv.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    WHERE v.venta_estado = 'completada'
      AND NOT EXISTS (SELECT 1 FROM anulacion_venta av WHERE av.venta_id = v.venta_id)
      AND datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    ORDER BY v.venta_id, dv.detalle_venta_id
  `);

  const groupedSales = new Map<string, SoldLine[]>();
  for (const line of lines) {
    const group = groupedSales.get(line.ventaId) ?? [];
    group.push(line);
    groupedSales.set(line.ventaId, group);
  }
  const products = new Map<number, Omit<ProductsMostSoldRow, "porcentajeUnidades">>();
  let totalUnidadesPeriodo = 0;
  for (const saleLines of groupedSales.values()) {
    const allocationInputs = saleLines.map((line) => {
      if (line.historialProductoId !== line.productoId ||
          !Number.isSafeInteger(line.cantidad) || line.cantidad <= 0 ||
          !Number.isSafeInteger(line.precioUnitario) || line.precioUnitario < 0) {
        throw new RangeError("Los datos de venta son incoherentes.");
      }
      const subtotal = line.cantidad * line.precioUnitario;
      if (!Number.isSafeInteger(subtotal)) throw new RangeError("Los datos de venta son incoherentes.");
      return { lineId: line.detalleVentaId, subtotal };
    });
    const subtotal = allocationInputs.reduce((sum, line) => safeAdd(sum, line.subtotal), 0);
    const [first] = saleLines;
    if (saleLines.some((line) => line.discountType !== first.discountType || line.discountValue !== first.discountValue)) {
      throw new RangeError("Los datos de venta son incoherentes.");
    }
    if (first.discountType === "porcentaje" && (!Number.isSafeInteger(first.discountValue) || first.discountValue! < 0 || first.discountValue! > 100)) {
      throw new RangeError("Los datos de venta son incoherentes.");
    }
    if (first.discountType === "monto" && (!Number.isSafeInteger(first.discountValue) || first.discountValue! < 0 || first.discountValue! > subtotal)) {
      throw new RangeError("Los datos de venta son incoherentes.");
    }
    const total = calculateRecordedSaleTotal({ subtotal, discountType: first.discountType, discountValue: first.discountValue });
    const netLines = allocateRecordedSaleNet(allocationInputs, total);
    for (let index = 0; index < saleLines.length; index += 1) {
      const line = saleLines[index];
      totalUnidadesPeriodo = safeAdd(totalUnidadesPeriodo, line.cantidad);
      const item = products.get(line.productoId) ?? {
        productoId: line.productoId, ean13: line.ean13, nombre: line.nombre,
        categoria: line.categoria, unidadesVendidas: 0, ingresoNeto: 0,
      };
      item.unidadesVendidas = safeAdd(item.unidadesVendidas, line.cantidad);
      item.ingresoNeto = safeAdd(item.ingresoNeto, netLines[index].neto);
      products.set(line.productoId, item);
    }
  }
  const filas = [...products.values()]
    .sort((a, b) => b.unidadesVendidas - a.unidadesVendidas || a.ean13.localeCompare(b.ean13) || a.productoId - b.productoId)
    .slice(0, 20)
    .map((item) => ({ ...item, porcentajeUnidades: item.unidadesVendidas / totalUnidadesPeriodo * 100 }));
  return { status: totalUnidadesPeriodo === 0 ? "empty" : "ready", periodo, totalUnidadesPeriodo, filas };
}

export async function loadAuthorizedProductsMostSold(
  payload: unknown,
  context: ControllerContext,
): Promise<AuthorizedProductsMostSoldReport> {
  if (!context.claims || context.claims.rol !== "dueno") throw new AccessDeniedError();
  const { db, schema } = await import("../../db/client");
  const user = await authorizeUser(db, schema, context.claims.usuarioId, ["dueno"], context.claims.rol);
  const report = await queryProductsMostSold(db, parseProductsMostSoldPeriod(payload));
  return { report, user };
}

export function createProductsMostSoldController(
  load = loadAuthorizedProductsMostSold,
): RegisteredController {
  const metadata = controllers.find((item) => item.id === "products-most-sold")!;
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "reporte:productos-mas-vendidos") return controllerError("INVALID_CHANNEL", "Canal de reporte no válido.", metadata.id);
      if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.", metadata.id);
      let periodo: ProductsMostSoldPeriod;
      try {
        periodo = parseProductsMostSoldPeriod(payload);
      } catch (error) {
        return controllerError("VALIDATION_ERROR", (error as Error).message, metadata.id);
      }
      try {
        const { report } = await load(periodo, context);
        return controllerSuccess(report);
      } catch (error) {
        if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message, metadata.id);
        console.error("[products-most-sold]", error);
        return controllerError("DATABASE_ERROR", PRODUCTS_MOST_SOLD_QUERY_ERROR_MESSAGE, metadata.id);
      }
    },
  };
}

export const productsMostSoldController = createProductsMostSoldController();
