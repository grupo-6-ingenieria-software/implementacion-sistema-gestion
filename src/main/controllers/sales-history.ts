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

type DailySaleHeaderRow = {
  ventaId: string;
  fechaHora: string;
  metodoPago: PaymentMethod;
  estado: 'completada' | 'anulada';
  discountType: 'ninguno' | 'porcentaje' | 'monto';
  discountValue: number | null;
};

export async function loadDailySalesHistory(
  database: SalesHistoryDb,
  now = new Date(),
): Promise<DailySalesHistory> {
  const { startUtc, endUtc } = getDashboardDay(now);
  // C18 respeta el orden de modelos del diseño: Venta -> Detalle -> Usuario
  // -> Trabajador -> AnulacionVenta. Las consultas separadas hacen visible el
  // contrato y evitan inferir una anulación sólo desde venta_estado.
  const saleRows = await database.all<DailySaleHeaderRow>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_fecha_hora AS fechaHora,
      v.venta_metodo_pago AS metodoPago,
      v.venta_estado AS estado,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue
    FROM venta v
    WHERE
      datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC
  `);

  const detailRows = await database.all<{
    ventaId: string;
    cantidadProductos: number;
    subtotal: number;
  }>(sql`
    SELECT
      v.venta_id AS ventaId,
      COALESCE(SUM(dv.detalle_venta_cantidad), 0) AS cantidadProductos,
      COALESCE(SUM(dv.detalle_venta_cantidad * hp.historial_precio_venta), 0) AS subtotal
    FROM venta v
    LEFT JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    LEFT JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    GROUP BY v.venta_id
  `);

  const userRows = await database.all<{ ventaId: string; trabajadorId: number }>(sql`
    SELECT v.venta_id AS ventaId, u.trabajador_id AS trabajadorId
    FROM venta v
    INNER JOIN usuario u ON u.usuario_id = v.usuario_cajero_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
  `);

  const workerRows = await database.all<{ trabajadorId: number; nombre: string }>(sql`
    SELECT DISTINCT
      t.trabajador_id AS trabajadorId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombre
    FROM trabajador t
    INNER JOIN usuario u ON u.trabajador_id = t.trabajador_id
    INNER JOIN venta v ON v.usuario_cajero_id = u.usuario_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
  `);

  const annulmentRows = await database.all<{ ventaId: string }>(sql`
    SELECT av.venta_id AS ventaId
    FROM anulacion_venta av
    INNER JOIN venta v ON v.venta_id = av.venta_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
  `);

  const details = new Map(detailRows.map((row) => [row.ventaId, row]));
  const users = new Map(userRows.map((row) => [row.ventaId, row.trabajadorId]));
  const workers = new Map(workerRows.map((row) => [row.trabajadorId, row.nombre]));
  const annulled = new Set(annulmentRows.map((row) => row.ventaId));

  const ventas = saleRows.map<DailySale>((row) => {
    const detail = details.get(row.ventaId);
    const workerId = users.get(row.ventaId);
    return {
      ventaId: row.ventaId,
      fechaHora: row.fechaHora,
      trabajadorResponsable:
        workerId === undefined ? '' : workers.get(workerId) ?? '',
      cantidadProductos: Number(detail?.cantidadProductos ?? 0),
      total: calculateRecordedSaleTotal({
        subtotal: Number(detail?.subtotal ?? 0),
        discountType: row.discountType,
        discountValue: row.discountValue,
      }),
      metodoPago: row.metodoPago,
      estado: annulled.has(row.ventaId) ? 'anulada' : 'confirmada',
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
