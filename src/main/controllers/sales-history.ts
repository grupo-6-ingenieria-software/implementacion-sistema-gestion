import { controllers } from "../../shared/controllers";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import {
  calculateCashChange,
  calculateRecordedSaleTotal,
  isValidSaleHistoryDate,
  isValidSaleId,
  type DailyPaymentSummary,
  type DailySale,
  type DailySalesHistory,
  type DailySalesSummary,
  type PaymentMethod,
  type SaleDetail,
  type SaleDetailLine,
  type SaleHistoryListItem,
  type SaleHistorySearchRequest,
  type SaleHistorySearchResult,
  type SaleSearchRequest,
  type SaleSearchResult,
} from "../../shared/sales";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { getChileDateRange, getDashboardDay } from "./dashboard-date";

const metadata = controllers[17];

export type SalesHistoryDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
};

export class SaleLookupValidationError extends Error {}
export class SaleLookupNotFoundError extends Error {}
export class SaleLookupBusinessError extends Error {}
export class SaleHistoryValidationError extends Error {}

type DailySaleHeaderRow = {
  ventaId: string;
  fechaHora: string;
  metodoPago: PaymentMethod;
  estado: "completada" | "anulada";
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
  usuarioId: string;
};

type SaleDetailHeaderRow = {
  ventaId: string;
  fechaHora: string;
  estado: "completada" | "anulada";
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
  discountReason: string | null;
  metodoPago: PaymentMethod;
  montoRecibido: number | null;
  usuarioId: string;
  responsable: string;
  cierreCajaId: string;
  cajaEstado: "abierto" | "cerrado";
  fechaApertura: string;
  fechaCierre: string | null;
  anulacionVentaId: string | null;
};

type SaleHistoryHeaderRow = {
  ventaId: string;
  fechaHora: string;
  metodoPago: PaymentMethod;
  estado: "completada" | "anulada";
  discountType: "ninguno" | "porcentaje" | "monto";
  discountValue: number | null;
  usuarioId: string;
  responsable: string;
  cajaEstado: "abierto" | "cerrado";
  anulacionVentaId: string | null;
  subtotal: number;
  esDelDia: number;
};

export async function findSaleForAnnulment(
  database: SalesHistoryDb,
  payload: SaleSearchRequest,
  now = new Date(),
): Promise<SaleSearchResult> {
  const ventaId = validateSaleId(payload);
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<{
    ventaId: string;
    estado: "completada" | "anulada";
    esDelDia: number;
    anulacionVentaId: string | null;
  }>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_estado AS estado,
      CASE
        WHEN datetime(v.venta_fecha_hora) >= datetime(${startUtc})
          AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
        THEN 1 ELSE 0
      END AS esDelDia,
      av.anulacion_venta_id AS anulacionVentaId
    FROM venta v
    LEFT JOIN anulacion_venta av ON av.venta_id = v.venta_id
    WHERE lower(v.venta_id) = lower(${ventaId})
    LIMIT 1
  `);
  const sale = rows[0];

  if (!sale) {
    throw new SaleLookupNotFoundError("La venta indicada no fue encontrada.");
  }
  if (Number(sale.esDelDia) !== 1) {
    throw new SaleLookupBusinessError(
      "Solo se pueden anular ventas registradas durante el día actual.",
    );
  }
  if (sale.estado === "anulada" || sale.anulacionVentaId) {
    throw new SaleLookupBusinessError("La venta indicada ya fue anulada.");
  }

  return { ventaId: sale.ventaId };
}

export async function loadSaleDetail(
  database: SalesHistoryDb,
  payload: SaleSearchRequest,
): Promise<SaleDetail> {
  const ventaId = validateSaleId(payload);
  const headerRows = await database.all<SaleDetailHeaderRow>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_fecha_hora AS fechaHora,
      v.venta_estado AS estado,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue,
      v.venta_descuento_razon AS discountReason,
      v.venta_metodo_pago AS metodoPago,
      ve.venta_efectivo_monto_recibido AS montoRecibido,
      v.usuario_cajero_id AS usuarioId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS responsable,
      c.cierre_caja_id AS cierreCajaId,
      c.cierre_estado AS cajaEstado,
      c.cierre_fecha_hora_inicio AS fechaApertura,
      c.cierre_fecha_hora_fin AS fechaCierre,
      av.anulacion_venta_id AS anulacionVentaId
    FROM venta v
    JOIN usuario u ON u.usuario_id = v.usuario_cajero_id
    JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    JOIN cierre_caja c ON c.cierre_caja_id = v.cierre_caja_id
    LEFT JOIN venta_efectivo ve ON ve.venta_id = v.venta_id
    LEFT JOIN anulacion_venta av ON av.venta_id = v.venta_id
    WHERE lower(v.venta_id) = lower(${ventaId})
    LIMIT 1
  `);
  const header = headerRows[0];

  if (!header) {
    throw new SaleLookupNotFoundError("La venta indicada no fue encontrada.");
  }

  const detailRows = await database.all<{
    productoId: number;
    ean13: string;
    nombre: string;
    cantidad: number;
    precioUnitario: number;
  }>(sql`
    SELECT
      dv.producto_id AS productoId,
      p.producto_ean_13 AS ean13,
      p.producto_nombre AS nombre,
      dv.detalle_venta_cantidad AS cantidad,
      hp.historial_precio_venta AS precioUnitario
    FROM detalle_venta dv
    JOIN producto p ON p.producto_id = dv.producto_id
    JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE dv.venta_id = ${header.ventaId}
    ORDER BY dv.producto_id ASC
  `);
  const productos = detailRows.map<SaleDetailLine>((row) => ({
    productoId: Number(row.productoId),
    ean13: row.ean13,
    nombre: row.nombre,
    cantidad: Number(row.cantidad),
    precioUnitario: Number(row.precioUnitario),
    subtotal: Number(row.cantidad) * Number(row.precioUnitario),
  }));
  const subtotal = productos.reduce((sum, line) => sum + line.subtotal, 0);
  const total = calculateRecordedSaleTotal({
    subtotal,
    discountType: header.discountType,
    discountValue: header.discountValue,
  });
  const discountValue =
    header.discountType === "ninguno" ? 0 : Number(header.discountValue ?? 0);
  const montoRecibido =
    header.montoRecibido === null ? undefined : Number(header.montoRecibido);

  return {
    ventaId: header.ventaId,
    fechaHora: header.fechaHora,
    estado:
      header.estado === "anulada" || header.anulacionVentaId
        ? "anulada"
        : "confirmada",
    responsable: {
      usuarioId: header.usuarioId,
      nombre: header.responsable,
    },
    productos,
    descuento: {
      tipo: header.discountType,
      valor: discountValue,
      ...(header.discountType !== "ninguno" && header.discountReason
        ? { razon: header.discountReason }
        : {}),
    },
    pago: {
      metodo: header.metodoPago,
      ...(montoRecibido === undefined
        ? {}
        : {
            montoRecibido,
            vuelto: calculateCashChange(total, montoRecibido),
          }),
    },
    subtotal,
    total,
    caja: {
      cierreCajaId: header.cierreCajaId,
      estado: header.cajaEstado === "abierto" ? "abierta" : "cerrada",
      fechaApertura: header.fechaApertura,
      ...(header.fechaCierre ? { fechaCierre: header.fechaCierre } : {}),
    },
  };
}

function validateSaleId(payload: SaleSearchRequest): string {
  if (!isValidSaleId(payload?.ventaId)) {
    throw new SaleLookupValidationError(
      "Ingrese un número de venta válido en formato UUID.",
    );
  }

  return payload.ventaId.trim();
}

export async function searchSalesHistory(
  database: SalesHistoryDb,
  payload: SaleHistorySearchRequest,
  now = new Date(),
): Promise<SaleHistorySearchResult> {
  const normalized = normalizeSaleHistorySearch(payload);
  const currentDay = getDashboardDay(now);
  const filter =
    normalized.criterio === "numero"
      ? sql`lower(v.venta_id) = lower(${normalized.ventaId})`
      : (() => {
          const range = getChileDateRange(
            normalized.fechaInicio,
            normalized.fechaTermino,
          );
          return sql`
            datetime(v.venta_fecha_hora) >= datetime(${range.startUtc})
            AND datetime(v.venta_fecha_hora) < datetime(${range.endUtc})
          `;
        })();

  const rows = await database.all<SaleHistoryHeaderRow>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_fecha_hora AS fechaHora,
      v.venta_metodo_pago AS metodoPago,
      v.venta_estado AS estado,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue,
      v.usuario_cajero_id AS usuarioId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS responsable,
      c.cierre_estado AS cajaEstado,
      av.anulacion_venta_id AS anulacionVentaId,
      COALESCE(SUM(
        dv.detalle_venta_cantidad * hp.historial_precio_venta
      ), 0) AS subtotal,
      CASE
        WHEN datetime(v.venta_fecha_hora) >= datetime(${currentDay.startUtc})
          AND datetime(v.venta_fecha_hora) < datetime(${currentDay.endUtc})
        THEN 1 ELSE 0
      END AS esDelDia
    FROM venta v
    JOIN usuario u ON u.usuario_id = v.usuario_cajero_id
    JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    JOIN cierre_caja c ON c.cierre_caja_id = v.cierre_caja_id
    LEFT JOIN anulacion_venta av ON av.venta_id = v.venta_id
    LEFT JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    LEFT JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE ${filter}
    GROUP BY
      v.venta_id,
      v.venta_fecha_hora,
      v.venta_metodo_pago,
      v.venta_estado,
      v.venta_descuento_tipo,
      v.venta_descuento_valor,
      v.usuario_cajero_id,
      t.trabajador_nombre,
      t.trabajador_apellido,
      c.cierre_estado,
      av.anulacion_venta_id
    ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC
  `);

  const ventas = rows.map<SaleHistoryListItem>((row) => {
    const estado =
      row.estado === "anulada" || row.anulacionVentaId
        ? "anulada"
        : "confirmada";
    const total = calculateRecordedSaleTotal({
      subtotal: Number(row.subtotal),
      discountType: row.discountType,
      discountValue: row.discountValue,
    });

    return {
      ventaId: row.ventaId,
      fechaHora: row.fechaHora,
      responsable: {
        usuarioId: row.usuarioId,
        nombre: row.responsable,
      },
      total,
      metodoPago: row.metodoPago,
      estado,
      puedeAnular:
        estado === "confirmada" &&
        Number(row.esDelDia) === 1 &&
        row.cajaEstado === "abierto",
    };
  });

  return {
    ventas,
    resumen: summarizeSalesHistory(ventas),
  };
}

export function summarizeSalesHistory(
  ventas: readonly SaleHistoryListItem[],
): SaleHistorySearchResult["resumen"] {
  return ventas.reduce<SaleHistorySearchResult["resumen"]>(
    (summary, sale) => {
      if (sale.estado === "anulada") {
        summary.ventasAnuladas += 1;
      } else {
        summary.ventasVigentes += 1;
        summary.montoVigente += sale.total;
      }
      return summary;
    },
    { ventasVigentes: 0, montoVigente: 0, ventasAnuladas: 0 },
  );
}

function normalizeSaleHistorySearch(
  payload: SaleHistorySearchRequest,
): SaleHistorySearchRequest {
  if (!payload || typeof payload !== "object") {
    throw new SaleHistoryValidationError(
      "Seleccione un criterio válido para consultar ventas.",
    );
  }

  if (payload.criterio === "numero") {
    if (!isValidSaleId(payload.ventaId)) {
      throw new SaleHistoryValidationError(
        "Ingrese un número de venta válido en formato UUID.",
      );
    }
    return { ...payload, ventaId: payload.ventaId.trim() };
  }

  if (payload.criterio === "rango") {
    const fechaInicio =
      typeof payload.fechaInicio === "string" ? payload.fechaInicio.trim() : "";
    const fechaTermino =
      typeof payload.fechaTermino === "string"
        ? payload.fechaTermino.trim()
        : "";

    if (!isValidSaleHistoryDate(fechaInicio)) {
      throw new SaleHistoryValidationError(
        "Ingrese una fecha de inicio válida.",
      );
    }
    if (!isValidSaleHistoryDate(fechaTermino)) {
      throw new SaleHistoryValidationError(
        "Ingrese una fecha de término válida.",
      );
    }
    if (fechaInicio > fechaTermino) {
      throw new SaleHistoryValidationError(
        "La fecha de inicio no puede ser posterior a la fecha de término.",
      );
    }

    return { ...payload, fechaInicio, fechaTermino };
  }

  throw new SaleHistoryValidationError(
    "Seleccione un criterio válido para consultar ventas.",
  );
}

function hasSaleHistoryCriterion(
  payload: unknown,
): payload is SaleHistorySearchRequest {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      Object.prototype.hasOwnProperty.call(payload, "criterio"),
  );
}

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
): RegisteredController<
  unknown,
  DailySalesHistory | SaleSearchResult | SaleHistorySearchResult | SaleDetail
> {
  return {
    metadata,
    handle: async (payload, context) => {
      try {
        if (context.channel === "venta:historial-dia") {
          return controllerSuccess(
            await loadDailySalesHistory(database, now()),
          );
        }

        if (context.channel === "venta:buscar") {
          if (hasSaleHistoryCriterion(payload)) {
            return controllerSuccess(
              await searchSalesHistory(database, payload, now()),
            );
          }

          return controllerSuccess(
            await findSaleForAnnulment(
              database,
              (payload ?? {}) as SaleSearchRequest,
              now(),
            ),
          );
        }

        if (context.channel === "venta:detalle") {
          return controllerSuccess(
            await loadSaleDetail(
              database,
              (payload ?? {}) as SaleSearchRequest,
            ),
          );
        }

        return controllerError(
          "INVALID_CHANNEL",
          `Canal IPC no registrado: ${context.channel}`,
          metadata.id,
        );
      } catch (error) {
        if (error instanceof SaleLookupValidationError) {
          return controllerError(
            "VALIDATION_ERROR",
            error.message,
            metadata.id,
          );
        }
        if (error instanceof SaleHistoryValidationError) {
          return controllerError(
            "VALIDATION_ERROR",
            error.message,
            metadata.id,
          );
        }
        if (error instanceof SaleLookupNotFoundError) {
          return controllerError("NOT_FOUND", error.message, metadata.id);
        }
        if (error instanceof SaleLookupBusinessError) {
          return controllerError("BUSINESS_RULE", error.message, metadata.id);
        }

        console.error(error);
        return controllerError(
          "TECHNICAL_ERROR",
          context.channel === "venta:historial-dia"
            ? "No fue posible cargar las ventas del dia."
            : context.channel === "venta:buscar" &&
                hasSaleHistoryCriterion(payload)
              ? "No fue posible consultar las ventas."
              : "No fue posible consultar la venta.",
          metadata.id,
        );
      }
    },
  };
}

export const salesHistoryController = createSalesHistoryController(
  db as unknown as SalesHistoryDb,
);
