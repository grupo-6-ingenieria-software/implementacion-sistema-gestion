import { controllers } from '../../shared/controllers';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  calculateRecordedSaleTotal,
  type DailyPaymentSummary,
  type DailySale,
  type DailySalesHistory,
  type DailySalesSummary,
  type PaymentMethod,
  type SaleState,
} from '../../shared/sales';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import { getDashboardDay } from './dashboard-date';

const metadata = controllers[17];

export type SalesHistoryDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
};

type DailySaleRow = {
  ventaId: string;
  fechaHora: string;
  trabajadorResponsable: string;
  cantidadProductos: number;
  subtotal: number;
  metodoPago: PaymentMethod;
  estado: SaleState;
  discountType: 'ninguno' | 'porcentaje' | 'monto';
  discountValue: number | null;
};

export async function loadDailySalesHistory(
  database: SalesHistoryDb,
  now = new Date(),
): Promise<DailySalesHistory> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<DailySaleRow>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_fecha_hora AS fechaHora,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido)
        AS trabajadorResponsable,
      COALESCE(SUM(dv.detalle_venta_cantidad), 0) AS cantidadProductos,
      COALESCE(
        SUM(dv.detalle_venta_cantidad * hp.historial_precio_venta),
        0
      ) AS subtotal,
      v.venta_metodo_pago AS metodoPago,
      v.venta_estado AS estado,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue
    FROM venta v
    INNER JOIN usuario u ON u.usuario_id = v.usuario_cajero_id
    INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    LEFT JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    LEFT JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE
      datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    GROUP BY
      v.venta_id,
      v.venta_fecha_hora,
      t.trabajador_nombre,
      t.trabajador_apellido,
      v.venta_metodo_pago,
      v.venta_estado,
      v.venta_descuento_tipo,
      v.venta_descuento_valor
    ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC
  `);

  const ventas = rows.map<DailySale>((row) => ({
    ventaId: row.ventaId,
    fechaHora: row.fechaHora,
    trabajadorResponsable: row.trabajadorResponsable,
    cantidadProductos: Number(row.cantidadProductos),
    total: calculateRecordedSaleTotal({
      subtotal: Number(row.subtotal),
      discountType: row.discountType,
      discountValue: row.discountValue,
    }),
    metodoPago: row.metodoPago,
    estado: row.estado,
  }));

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
    if (venta.estado === 'anulada') {
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
        return controllerSuccess(
          await loadDailySalesHistory(database, now()),
        );
      } catch (error) {
        console.error(error);
        return controllerError(
          'TECHNICAL_ERROR',
          'No fue posible cargar las ventas del dia.',
          metadata.id,
        );
      }
    },
  };
}

export const salesHistoryController = createSalesHistoryController(
  db as unknown as SalesHistoryDb,
);
