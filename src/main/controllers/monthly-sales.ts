import { sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import { calculateRecordedSaleTotal, getChileDateKey, type PaymentMethod } from "../../shared/sales";
import {
  MONTHLY_SALES_EMPTY_MESSAGE, monthlyPeriodKey, parseMonthlySalesPeriod,
  type MonthlySalesPeriod, type MonthlySalesReport,
} from "../../shared/monthly-sales";
import { getChileDateRange } from "./dashboard-date";
import { AccessDeniedError, authorizeUser, type AuthenticatedUser } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerContext, type RegisteredController } from "./base";

type MonthlySalesRow = {
  fechaHora: string;
  metodoPago: PaymentMethod;
  subtotal: number;
  discountType: "ninguno" | "monto" | "porcentaje";
  discountValue: number | null;
};
export type MonthlySalesExecutor = { all: <T>(query: SQL) => Promise<T[]> };
export type AuthorizedMonthlySalesReport = { report: MonthlySalesReport; user: AuthenticatedUser };

export async function queryMonthlySales(
  database: MonthlySalesExecutor,
  period: MonthlySalesPeriod,
): Promise<MonthlySalesReport> {
  const { mes, anio } = parseMonthlySalesPeriod(period);
  const key = monthlyPeriodKey(period);
  const previous = mes === 1 ? { mes: 12, anio: anio - 1 } : { mes: mes - 1, anio };
  const previousKey = monthlyPeriodKey(previous);
  const daysInMonth = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const { startUtc, endUtc } = getChileDateRange(`${previousKey}-01`, `${key}-${daysInMonth}`);
  const rows = await database.all<MonthlySalesRow>(sql`
    SELECT v.venta_fecha_hora AS fechaHora, v.venta_metodo_pago AS metodoPago,
      v.venta_descuento_tipo AS discountType, v.venta_descuento_valor AS discountValue,
      COALESCE(SUM(dv.detalle_venta_cantidad * hp.historial_precio_venta), 0) AS subtotal
    FROM venta v
    LEFT JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    LEFT JOIN historial_precio_producto hp ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE v.venta_estado = 'completada'
      AND NOT EXISTS (SELECT 1 FROM anulacion_venta av WHERE av.venta_id = v.venta_id)
      AND datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    GROUP BY v.venta_id, v.venta_fecha_hora, v.venta_metodo_pago,
      v.venta_descuento_tipo, v.venta_descuento_valor
  `);
  const dias = Array.from({ length: daysInMonth }, (_, index) => ({
    fecha: `${key}-${String(index + 1).padStart(2, "0")}`, transacciones: 0, monto: 0,
  }));
  const metodos = (["efectivo", "debito", "credito", "transferencia"] as const)
    .map((metodo) => ({ metodo, transacciones: 0, monto: 0 }));
  let montoMesAnterior = 0;
  for (const row of rows) {
    const timestamp = row.fechaHora.replace(" ", "T");
    const fecha = getChileDateKey(new Date(/[zZ]|[+-]\d\d:\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`));
    const monto = calculateRecordedSaleTotal(row);
    if (fecha.startsWith(previousKey)) {
      montoMesAnterior += monto;
      continue;
    }
    const dia = dias.find((item) => item.fecha === fecha);
    if (!dia) continue;
    dia.transacciones += 1;
    dia.monto += monto;
    const metodo = metodos.find((item) => item.metodo === row.metodoPago)!;
    metodo.transacciones += 1;
    metodo.monto += monto;
  }
  const transacciones = dias.reduce((sum, day) => sum + day.transacciones, 0);
  const montoTotal = dias.reduce((sum, day) => sum + day.monto, 0);
  return {
    periodo: { mes, anio }, dias, metodos, transacciones, montoTotal, montoMesAnterior,
    variacionPorcentual: montoMesAnterior === 0 ? null : (montoTotal - montoMesAnterior) / montoMesAnterior * 100,
  };
}

export async function loadAuthorizedMonthlySales(
  payload: unknown,
  context: ControllerContext,
): Promise<AuthorizedMonthlySalesReport> {
  if (!context.claims || context.claims.rol !== "dueno") throw new AccessDeniedError();
  const { db, schema } = await import("../../db/client");
  const user = await authorizeUser(db, schema, context.claims.usuarioId, ["dueno"], context.claims.rol);
  const report = await queryMonthlySales(db, parseMonthlySalesPeriod(payload));
  return { report, user };
}

export function createMonthlySalesController(
  load = loadAuthorizedMonthlySales,
): RegisteredController {
  const metadata = controllers.find((item) => item.id === "monthly-sales")!;
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "reporte:ventas-mensuales") return controllerError("INVALID_CHANNEL", "Canal de reporte no válido.", metadata.id);
      if (!context.claims || context.claims.rol !== "dueno") return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.", metadata.id);
      try {
        const period = parseMonthlySalesPeriod(payload);
        const { report } = await load(period, context);
        if (report.transacciones === 0) return controllerError("BUSINESS_RULE", MONTHLY_SALES_EMPTY_MESSAGE, metadata.id);
        return controllerSuccess(report);
      } catch (error) {
        if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message, metadata.id);
        if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message, metadata.id);
        console.error("[monthly-sales]", error);
        return controllerError("DATABASE_ERROR", "No fue posible consultar las ventas mensuales. Intente nuevamente.", metadata.id);
      }
    },
  };
}

export const monthlySalesController = createMonthlySalesController();
