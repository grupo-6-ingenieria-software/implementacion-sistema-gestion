import { controllers } from "../../shared/controllers";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import {
  calculateRecordedSaleTotal,
  type DailyPaymentSummary,
  type DailySale,
  type DailySalesHistory,
  type DailySalesSummary,
  type PaymentMethod,
} from "../../shared/sales";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { getDashboardDay } from "./dashboard-date";

const metadata = controllers[17];

export type SalesHistoryDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
};

type DailySaleHeaderRow = {
  ventaId: string;
  fechaHora: string;
  metodoPago: PaymentMethod;
  estado: "completada" | "anulada";
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
  usuarioId: string;
};

export async function loadDailySalesHistory(
  database: SalesHistoryDb,
  now = new Date(),
): Promise<DailySalesHistory> {
  const { startUtc, endUtc } = getDashboardDay(now);

  const saleRows = await database.all<DailySaleHeaderRow>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_fecha_hora AS fechaHora,
      v.venta_metodo_pago AS metodoPago,
      v.venta_estado AS estado,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue
      , v.usuario_cajero_id AS usuarioId
    FROM venta v
    WHERE
      datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC
  `);

  if (saleRows.length === 0) {
    return { ventas: [], resumen: summarizeDailySalesHistory([]) };
  }

  const saleIds = sql.join(
    saleRows.map((row) => sql`${row.ventaId}`),
    sql`, `,
  );
  const detailRows = await database.all<{
    ventaId: string;
    cantidad: number;
    historialPrecioProductoId: string;
  }>(sql`
    SELECT venta_id AS ventaId,
      detalle_venta_cantidad AS cantidad,
      historial_precio_producto_id AS historialPrecioProductoId
    FROM detalle_venta
    WHERE venta_id IN (${saleIds})
  `);
  const priceIds = [
    ...new Set(detailRows.map((row) => row.historialPrecioProductoId)),
  ];
  const priceRows =
    priceIds.length === 0
      ? []
      : await database.all<{
          historialPrecioProductoId: string;
          precio: number;
        }>(sql`
    SELECT historial_precio_producto_id AS historialPrecioProductoId,
      historial_precio_venta AS precio
    FROM historial_precio_producto
    WHERE historial_precio_producto_id IN (${sql.join(
      priceIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  const userIds = [...new Set(saleRows.map((row) => row.usuarioId))];
  const userRows = await database.all<{
    usuarioId: string;
    trabajadorId: number;
  }>(sql`
    SELECT usuario_id AS usuarioId, trabajador_id AS trabajadorId
    FROM usuario
    WHERE usuario_id IN (${sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  const workerIds = [...new Set(userRows.map((row) => row.trabajadorId))];
  const workerRows =
    workerIds.length === 0
      ? []
      : await database.all<{ trabajadorId: number; nombre: string }>(sql`
    SELECT trabajador_id AS trabajadorId,
      trim(trabajador_nombre || ' ' || trabajador_apellido) AS nombre
    FROM trabajador
    WHERE trabajador_id IN (${sql.join(
      workerIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);

  const annulmentRows = await database.all<{ ventaId: string }>(sql`
    SELECT venta_id AS ventaId
    FROM anulacion_venta
    WHERE venta_id IN (${saleIds})
  `);
  const prices = new Map(
    priceRows.map((row) => [row.historialPrecioProductoId, Number(row.precio)]),
  );
  const details = new Map<
    string,
    { cantidadProductos: number; subtotal: number }
  >();
  for (const detail of detailRows) {
    const current = details.get(detail.ventaId) ?? {
      cantidadProductos: 0,
      subtotal: 0,
    };
    current.cantidadProductos += Number(detail.cantidad);
    current.subtotal +=
      Number(detail.cantidad) *
      (prices.get(detail.historialPrecioProductoId) ?? 0);
    details.set(detail.ventaId, current);
  }
  const users = new Map(
    userRows.map((row) => [row.usuarioId, row.trabajadorId]),
  );
  const workers = new Map(
    workerRows.map((row) => [row.trabajadorId, row.nombre]),
  );
  const annulled = new Set(annulmentRows.map((row) => row.ventaId));

  const ventas = saleRows.map<DailySale>((row) => {
    const detail = details.get(row.ventaId);
    const workerId = users.get(row.usuarioId);
    return {
      ventaId: row.ventaId,
      fechaHora: row.fechaHora,
      trabajadorResponsable:
        workerId === undefined ? "" : (workers.get(workerId) ?? ""),
      cantidadProductos: Number(detail?.cantidadProductos ?? 0),
      total: calculateRecordedSaleTotal({
        subtotal: Number(detail?.subtotal ?? 0),
        discountType: row.discountType,
        discountValue: row.discountValue,
      }),
      metodoPago: row.metodoPago,
      estado: annulled.has(row.ventaId) ? "anulada" : "confirmada",
    };
  });

  return {
    ventas,
    resumen: summarizeDailySalesHistory(ventas),
  };
}

export function summarizeDailySalesHistory(
  ventas: readonly DailySale[],
): DailySalesSummary {
  const summary: DailySalesSummary = {
    ventasVigentes: 0,
    montoVigente: 0,
    porMetodoPago: {
      efectivo: emptyPaymentSummary(),
      debito: emptyPaymentSummary(),
      credito: emptyPaymentSummary(),
      transferencia: emptyPaymentSummary(),
    },
    ventasAnuladas: 0,
    montoAnulado: 0,
  };

  for (const venta of ventas) {
    if (venta.estado === "anulada") {
      summary.ventasAnuladas += 1;
      summary.montoAnulado += venta.total;
      continue;
    }

    summary.ventasVigentes += 1;
    summary.montoVigente += venta.total;
    summary.porMetodoPago[venta.metodoPago].cantidadVentas += 1;
    summary.porMetodoPago[venta.metodoPago].monto += venta.total;
  }

  return summary;
}

function emptyPaymentSummary(): DailyPaymentSummary {
  return {
    cantidadVentas: 0,
    monto: 0,
  };
}

export function createSalesHistoryController(
  database: SalesHistoryDb,
  now: () => Date = () => new Date(),
): RegisteredController<unknown, DailySalesHistory> {
  return {
    metadata,
    handle: async () => {
      try {
        return controllerSuccess(await loadDailySalesHistory(database, now()));
      } catch (error) {
        console.error(error);
        return controllerError(
          "TECHNICAL_ERROR",
          "No fue posible cargar las ventas del dia.",
          metadata.id,
        );
      }
    },
  };
}

export const salesHistoryController = createSalesHistoryController(
  db as unknown as SalesHistoryDb,
);
