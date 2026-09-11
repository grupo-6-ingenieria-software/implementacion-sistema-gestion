import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  hasSupplierOrderFieldErrors,
  isUuid,
  normalizeSupplierOrderCancelPayload,
  normalizeSupplierOrderClosePayload,
  normalizeSupplierOrderDetailPayload,
  normalizeSupplierOrderListPayload,
  normalizeSupplierOrderReceptionPayload,
  type SupplierOrderCancelPayload,
  type SupplierOrderClosePayload,
  type SupplierOrderDetail,
  type SupplierOrderFieldErrors,
  type SupplierOrderFinishResponse,
  type SupplierOrderHistoryEvent,
  type SupplierOrderListItem,
  type SupplierOrderReceptionHistory,
  type SupplierOrderReceptionLineHistory,
  type SupplierOrderReceptionPayload,
  type SupplierOrderReceptionResponse,
  type SupplierOrderState,
  validateSupplierOrderReceptionShape,
} from "../../shared/supplier-orders";
import type { RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from "./auth-context";
import { notifyDashboardUpdated } from "./dashboard-events";
import { notifySupplierOrdersUpdated } from "./supplier-order-events";

type SchemaLike = typeof import("../../db/schema");
type QueryExecutor = Pick<
  typeof import("../../db/client").db,
  "all" | "insert" | "select"
>;
type MutationExecutor = QueryExecutor &
  Pick<typeof import("../../db/client").db, "update">;

type ReceptionControllerData =
  | SupplierOrderListItem[]
  | SupplierOrderDetail
  | SupplierOrderReceptionResponse
  | SupplierOrderFinishResponse;

export function createSupplierOrderReceptionController(): RegisteredController<
  unknown,
  ReceptionControllerData
> {
  const metadata = controllers.find(
    (controller) => controller.id === "supplier-order-reception",
  );

  if (!metadata) {
    throw new Error("Falta declarar el controlador supplier-order-reception.");
  }

  return {
    metadata,
    handle: async (payload, context) => {
      try {
        switch (context.channel) {
          case "pedido:listar":
            return { ok: true, data: await listSupplierOrders(payload) };
          case "pedido:detalle":
            return { ok: true, data: await loadSupplierOrderDetail(payload) };
          case "pedido:confirmar-recepcion": {
            const input = normalizeSupplierOrderReceptionPayload(payload);
            const errors = validateSupplierOrderReceptionShape(input);
            if (hasSupplierOrderFieldErrors(errors)) {
              return validationResponse(errors);
            }
            return {
              ok: true,
              data: await confirmSupplierOrderReception(input),
            };
          }
          case "pedido:cancelar": {
            const input = normalizeSupplierOrderCancelPayload(payload);
            const errors = validateFinishInput(input);
            if (hasSupplierOrderFieldErrors(errors)) {
              return validationResponse(errors);
            }
            return { ok: true, data: await cancelSupplierOrder(input) };
          }
          case "pedido:cerrar-saldo": {
            const input = normalizeSupplierOrderClosePayload(payload);
            const errors = validateFinishInput(input);
            if (!input.motivo) {
              errors.motivo = "Ingrese el motivo del cierre de saldo.";
            }
            if (hasSupplierOrderFieldErrors(errors)) {
              return validationResponse(errors);
            }
            return { ok: true, data: await closeSupplierOrderBalance(input) };
          }
          default:
            return {
              ok: false,
              error: {
                code: "INVALID_CHANNEL",
                controllerId: "supplier-order-reception",
                message: `Canal IPC no registrado: ${context.channel}`,
              },
            };
        }
      } catch (error) {
        return normalizeReceptionError(error);
      }
    },
  };
}

async function listSupplierOrders(
  payload: unknown,
): Promise<SupplierOrderListItem[]> {
  const { db, schema } = await import("../../db/client");
  const input = normalizeSupplierOrderListPayload(payload);
  return listSupplierOrdersWithExecutor(db, schema, input);
}

export async function listSupplierOrdersWithExecutor(
  executor: QueryExecutor,
  schema: SchemaLike,
  payload: ReturnType<typeof normalizeSupplierOrderListPayload>,
): Promise<SupplierOrderListItem[]> {
  await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);

  const stateFilter = buildStateFilter(payload.estado);
  const rows = await executor.all<{
    pedidoId: string;
    fechaHoraEmision: string;
    estado: SupplierOrderState;
    proveedorId: number;
    proveedorNombre: string;
    totalSolicitado: number;
    totalRecibido: number;
  }>(sql`
    SELECT
      pp.pedido_proveedor_id AS pedidoId,
      pp.pedido_proveedor_fecha_hora_emision AS fechaHoraEmision,
      pp.pedido_proveedor_estado AS estado,
      pr.proveedor_id AS proveedorId,
      pr.proveedor_nombre_razon_social AS proveedorNombre,
      COALESCE(SUM(dp.cantidad_solicitada), 0) AS totalSolicitado,
      COALESCE(SUM(dp.cantidad_recibida), 0) AS totalRecibido
    FROM pedido_proveedor pp
    INNER JOIN proveedor pr ON pr.proveedor_id = pp.proveedor_id
    LEFT JOIN detalle_pedido dp
      ON dp.pedido_proveedor_id = pp.pedido_proveedor_id
    ${stateFilter}
    GROUP BY
      pp.pedido_proveedor_id,
      pp.pedido_proveedor_fecha_hora_emision,
      pp.pedido_proveedor_estado,
      pr.proveedor_id,
      pr.proveedor_nombre_razon_social
    ORDER BY datetime(pp.pedido_proveedor_fecha_hora_emision) DESC,
      pp.pedido_proveedor_id DESC
  `);

  return rows.map((row) => ({
    ...row,
    proveedorId: Number(row.proveedorId),
    totalSolicitado: Number(row.totalSolicitado),
    totalRecibido: Number(row.totalRecibido),
    totalPendiente:
      Number(row.totalSolicitado) - Number(row.totalRecibido),
  }));
}

async function loadSupplierOrderDetail(
  payload: unknown,
): Promise<SupplierOrderDetail> {
  const { db, schema } = await import("../../db/client");
  const input = normalizeSupplierOrderDetailPayload(payload);

  if (!isUuid(input.pedidoId)) {
    throw new SupplierOrderDomainError(
      "validation",
      "Seleccione un pedido válido.",
      { pedidoId: "Seleccione un pedido válido." },
    );
  }

  return loadSupplierOrderDetailWithExecutor(
    db,
    schema,
    input.pedidoId,
    input.usuarioId,
  );
}

export async function loadSupplierOrderDetailWithExecutor(
  executor: QueryExecutor,
  schema: SchemaLike,
  pedidoId: string,
  usuarioId?: string,
): Promise<SupplierOrderDetail> {
  await authorizeUser(executor, schema, usuarioId, ["dueno", "trabajador"]);

  const headers = await executor.all<{
    pedidoId: string;
    fechaHoraEmision: string;
    estado: SupplierOrderState;
    proveedorId: number;
    proveedorNombre: string;
    proveedorRut: string;
    emisorId: string;
  }>(sql`
    SELECT
      pp.pedido_proveedor_id AS pedidoId,
      pp.pedido_proveedor_fecha_hora_emision AS fechaHoraEmision,
      pp.pedido_proveedor_estado AS estado,
      pr.proveedor_id AS proveedorId,
      pr.proveedor_nombre_razon_social AS proveedorNombre,
      pr.proveedor_rut AS proveedorRut,
      pp.usuario_emisor_id AS emisorId
    FROM pedido_proveedor pp
    INNER JOIN proveedor pr ON pr.proveedor_id = pp.proveedor_id
    WHERE pp.pedido_proveedor_id = ${pedidoId}
    LIMIT 1
  `);
  const header = headers[0];

  if (!header) {
    throw new SupplierOrderDomainError(
      "not-found",
      "El pedido solicitado no existe.",
    );
  }

  const rawLines = await executor.all<{
    detallePedidoId: string;
    productoId: number;
    ean13: string;
    nombre: string;
    categoria: string;
    exigeVencimiento: number;
    cantidadSolicitada: number;
    cantidadRecibida: number;
  }>(sql`
    SELECT
      dp.detalle_pedido_id AS detallePedidoId,
      p.producto_id AS productoId,
      p.producto_ean_13 AS ean13,
      p.producto_nombre AS nombre,
      c.categoria_nombre AS categoria,
      c.categoria_exige_vencimiento AS exigeVencimiento,
      dp.cantidad_solicitada AS cantidadSolicitada,
      COALESCE(dp.cantidad_recibida, 0) AS cantidadRecibida
    FROM detalle_pedido dp
    INNER JOIN producto p ON p.producto_id = dp.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    WHERE dp.pedido_proveedor_id = ${pedidoId}
    ORDER BY p.producto_nombre ASC, dp.detalle_pedido_id ASC
  `);
  const lines = rawLines.map((line) => ({
    ...line,
    productoId: Number(line.productoId),
    exigeVencimiento: Boolean(line.exigeVencimiento),
    cantidadSolicitada: Number(line.cantidadSolicitada),
    cantidadRecibida: Number(line.cantidadRecibida),
    cantidadPendiente:
      Number(line.cantidadSolicitada) - Number(line.cantidadRecibida),
  }));
  const receptions = await loadReceptionHistory(executor, pedidoId);
  const history = await loadOrderHistory(executor, pedidoId);
  const totalReceived = lines.reduce(
    (total, line) => total + line.cantidadRecibida,
    0,
  );
  const totalPending = lines.reduce(
    (total, line) => total + line.cantidadPendiente,
    0,
  );

  return {
    ...header,
    proveedorId: Number(header.proveedorId),
    lineas: lines,
    recepciones: receptions,
    historial: history,
    puedeRecibir:
      (header.estado === "pendiente" || header.estado === "parcial") &&
      totalPending > 0,
    puedeCancelar:
      header.estado === "pendiente" &&
      totalReceived === 0 &&
      receptions.length === 0,
    puedeCerrarSaldo:
      header.estado === "parcial" && totalReceived > 0 && totalPending > 0,
  };
}

async function loadReceptionHistory(
  executor: QueryExecutor,
  pedidoId: string,
): Promise<SupplierOrderReceptionHistory[]> {
  const headers = await executor.all<{
    recepcionId: string;
    operacionId: string;
    fechaHora: string;
    responsableId: string;
    responsableNombre: string;
    estadoResultante: "parcial" | "recibido";
  }>(sql`
    SELECT
      rp.recepcion_pedido_id AS recepcionId,
      rp.recepcion_operacion_id AS operacionId,
      rp.recepcion_fecha_hora AS fechaHora,
      rp.usuario_id AS responsableId,
      TRIM(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS responsableNombre,
      rp.recepcion_estado_resultante AS estadoResultante
    FROM recepcion_pedido rp
    INNER JOIN usuario u ON u.usuario_id = rp.usuario_id
    INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE rp.pedido_proveedor_id = ${pedidoId}
    ORDER BY datetime(rp.recepcion_fecha_hora) ASC, rp.recepcion_pedido_id ASC
  `);
  const rawLines = await executor.all<
    SupplierOrderReceptionLineHistory & { recepcionId: string }
  >(sql`
    SELECT
      dr.recepcion_pedido_id AS recepcionId,
      dr.detalle_pedido_id AS detallePedidoId,
      p.producto_ean_13 AS ean13,
      p.producto_nombre AS nombre,
      dr.detalle_recepcion_cantidad AS cantidad,
      l.lote_id AS loteId,
      l.lote_precio_costo AS precioCosto,
      lp.lote_perecible_fecha_vencimiento AS fechaVencimiento
    FROM detalle_recepcion dr
    INNER JOIN detalle_pedido dp ON dp.detalle_pedido_id = dr.detalle_pedido_id
    INNER JOIN producto p ON p.producto_id = dp.producto_id
    INNER JOIN lote l ON l.lote_id = dr.lote_id
    LEFT JOIN lote_perecible lp ON lp.lote_id = l.lote_id
    INNER JOIN recepcion_pedido rp
      ON rp.recepcion_pedido_id = dr.recepcion_pedido_id
    WHERE rp.pedido_proveedor_id = ${pedidoId}
    ORDER BY rp.recepcion_fecha_hora ASC, p.producto_nombre ASC
  `);
  const linesByReceipt = new Map<string, SupplierOrderReceptionLineHistory[]>();

  for (const line of rawLines) {
    const lines = linesByReceipt.get(line.recepcionId) ?? [];
    lines.push({
      detallePedidoId: line.detallePedidoId,
      ean13: line.ean13,
      nombre: line.nombre,
      cantidad: Number(line.cantidad),
      loteId: line.loteId,
      precioCosto: Number(line.precioCosto),
      fechaVencimiento: line.fechaVencimiento,
    });
    linesByReceipt.set(line.recepcionId, lines);
  }

  return headers.map((header) => ({
    ...header,
    lineas: linesByReceipt.get(header.recepcionId) ?? [],
  }));
}

async function loadOrderHistory(
  executor: QueryExecutor,
  pedidoId: string,
): Promise<SupplierOrderHistoryEvent[]> {
  return executor.all<SupplierOrderHistoryEvent>(sql`
    SELECT
      hap.historial_auditoria_pedido_id AS id,
      hap.historial_ap_tipo_evento AS tipo,
      hap.historial_ap_fecha_hora AS fechaHora,
      hap.historial_ap_nota AS nota,
      hap.usuario_id AS responsableId,
      TRIM(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS responsableNombre
    FROM historial_auditoria_pedido hap
    INNER JOIN usuario u ON u.usuario_id = hap.usuario_id
    INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE hap.pedido_proveedor_id = ${pedidoId}
    ORDER BY datetime(hap.historial_ap_fecha_hora) ASC,
      hap.historial_auditoria_pedido_id ASC
  `);
}

async function confirmSupplierOrderReception(
  payload: SupplierOrderReceptionPayload,
): Promise<SupplierOrderReceptionResponse> {
  const { db, schema } = await import("../../db/client");

  try {
    const result = await db.transaction((tx) =>
      confirmSupplierOrderReceptionWithExecutor(tx, schema, payload),
    );
    notifySupplierOrdersUpdated();
    notifyDashboardUpdated();
    return result;
  } catch (error) {
    if (isUniqueOperationError(error)) {
      const existing = await findExistingReception(db, schema, payload);
      if (existing) {
        return { ...existing, idempotente: true };
      }
    }
    throw error;
  }
}

export async function confirmSupplierOrderReceptionWithExecutor(
  executor: MutationExecutor,
  schema: SchemaLike,
  payload: SupplierOrderReceptionPayload,
): Promise<SupplierOrderReceptionResponse> {
  const shapeErrors = validateSupplierOrderReceptionShape(payload);
  if (hasSupplierOrderFieldErrors(shapeErrors)) {
    throw new SupplierOrderDomainError(
      "validation",
      "Revise los campos marcados antes de continuar.",
      shapeErrors,
    );
  }

  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  const existing = await findExistingReception(executor, schema, payload);
  if (existing) {
    return { ...existing, idempotente: true };
  }

  const orderRows = await executor
    .select({
      id: schema.pedidoProveedor.pedidoProveedorId,
      estado: schema.pedidoProveedor.pedidoProveedorEstado,
      proveedorId: schema.pedidoProveedor.proveedorId,
    })
    .from(schema.pedidoProveedor)
    .where(eq(schema.pedidoProveedor.pedidoProveedorId, payload.pedidoId))
    .limit(1);
  const order = orderRows[0];

  if (!order) {
    throw new SupplierOrderDomainError(
      "not-found",
      "El pedido solicitado no existe.",
    );
  }
  if (order.estado !== "pendiente" && order.estado !== "parcial") {
    throw new SupplierOrderDomainError(
      "state",
      "El pedido ya no admite nuevas recepciones.",
    );
  }

  const dbLines = await executor
    .select({
      detallePedidoId: schema.detallePedido.detallePedidoId,
      cantidadSolicitada: schema.detallePedido.cantidadSolicitada,
      cantidadRecibida: schema.detallePedido.cantidadRecibida,
      productoId: schema.detallePedido.productoId,
      exigeVencimiento: schema.categoria.categoriaExigeVencimiento,
    })
    .from(schema.detallePedido)
    .innerJoin(
      schema.producto,
      eq(schema.producto.productoId, schema.detallePedido.productoId),
    )
    .innerJoin(
      schema.categoria,
      eq(schema.categoria.categoriaId, schema.producto.categoriaId),
    )
    .where(eq(schema.detallePedido.pedidoProveedorId, payload.pedidoId));
  const dbLineById = new Map(
    dbLines.map((line) => [line.detallePedidoId, line]),
  );
  const fieldErrors: SupplierOrderFieldErrors = {};

  if (payload.lineas.length !== dbLines.length) {
    fieldErrors.lineas = "Incluya todas las líneas del pedido en la entrega.";
  }

  payload.lineas.forEach((line, index) => {
    const current = dbLineById.get(line.detallePedidoId);
    if (!current) {
      fieldErrors[`lineas.${index}.detallePedidoId`] =
        "La línea no pertenece al pedido seleccionado.";
      return;
    }

    const pending =
      Number(current.cantidadSolicitada) - Number(current.cantidadRecibida);
    if (line.cantidad > pending) {
      fieldErrors[`lineas.${index}.cantidad`] =
        `La cantidad no puede superar el saldo pendiente (${pending}).`;
    }

    if (line.cantidad <= 0) {
      return;
    }

    if (current.exigeVencimiento) {
      if (!line.fechaVencimiento) {
        fieldErrors[`lineas.${index}.fechaVencimiento`] =
          "La fecha de vencimiento es obligatoria para este producto.";
      } else if (!isValidIsoDate(line.fechaVencimiento)) {
        fieldErrors[`lineas.${index}.fechaVencimiento`] =
          "Ingrese una fecha de vencimiento válida.";
      } else if (line.fechaVencimiento <= todayIso()) {
        fieldErrors[`lineas.${index}.fechaVencimiento`] =
          "La fecha de vencimiento debe ser posterior a hoy.";
      }
    }
  });

  if (hasSupplierOrderFieldErrors(fieldErrors)) {
    throw new SupplierOrderDomainError(
      "validation",
      "La recepción contiene datos inválidos.",
      fieldErrors,
    );
  }

  const createdReceipts = await executor
    .insert(schema.recepcionPedido)
    .values({
      recepcionOperacionId: payload.operacionId,
      recepcionEstadoResultante: "parcial",
      pedidoProveedorId: order.id,
      usuarioId: user.usuarioId,
    })
    .returning({ id: schema.recepcionPedido.recepcionPedidoId });
  const receiptId = createdReceipts[0].id;

  for (const [index, input] of payload.lineas.entries()) {
    if (input.cantidad <= 0) continue;
    const current = dbLineById.get(input.detallePedidoId)!;
    const createdLots = await executor
      .insert(schema.lote)
      .values({
        loteCantidadInicial: input.cantidad,
        loteCantidadActual: input.cantidad,
        lotePrecioCosto: input.precioCosto!,
        esLotePerecible: current.exigeVencimiento,
        esLoteNoPerecible: !current.exigeVencimiento,
        productoId: current.productoId,
        proveedorId: order.proveedorId,
        pedidoProveedorId: order.id,
      })
      .returning({ id: schema.lote.loteId });
    const loteId = createdLots[0].id;

    if (current.exigeVencimiento) {
      await executor.insert(schema.lotePerecible).values({
        loteId,
        lotePerecibleFechaVencimiento: input.fechaVencimiento!,
      });
    }

    await executor.insert(schema.detalleRecepcion).values({
      recepcionPedidoId: receiptId,
      detallePedidoId: current.detallePedidoId,
      loteId,
      detalleRecepcionCantidad: input.cantidad,
    });

    const updated = await executor
      .update(schema.detallePedido)
      .set({
        cantidadRecibida: sql`${schema.detallePedido.cantidadRecibida} + ${input.cantidad}`,
      })
      .where(
        and(
          eq(
            schema.detallePedido.detallePedidoId,
            current.detallePedidoId,
          ),
          sql`${schema.detallePedido.cantidadRecibida} + ${input.cantidad} <= ${schema.detallePedido.cantidadSolicitada}`,
        ),
      )
      .returning({ id: schema.detallePedido.detallePedidoId });

    if (updated.length !== 1) {
      throw new SupplierOrderDomainError(
        "concurrency",
        "El saldo del pedido cambió. Recargue el detalle e intente nuevamente.",
        {
          [`lineas.${index}.cantidad`]:
            "El saldo disponible cambió durante la confirmación.",
        },
      );
    }
  }

  const balanceRows = await executor.all<{ pendiente: number }>(sql`
    SELECT COALESCE(SUM(cantidad_solicitada - cantidad_recibida), 0) AS pendiente
    FROM detalle_pedido
    WHERE pedido_proveedor_id = ${order.id}
  `);
  const nextState =
    Number(balanceRows[0]?.pendiente ?? 0) === 0 ? "recibido" : "parcial";

  if (nextState === "recibido") {
    await executor
      .update(schema.recepcionPedido)
      .set({ recepcionEstadoResultante: nextState })
      .where(eq(schema.recepcionPedido.recepcionPedidoId, receiptId));
  }

  const updatedOrder = await executor
    .update(schema.pedidoProveedor)
    .set({
      pedidoProveedorEstado: nextState,
      pedidoProveedorFechaHoraRecepcion: sql`datetime('now')`,
      usuarioReceptorId: user.usuarioId,
    })
    .where(
      and(
        eq(schema.pedidoProveedor.pedidoProveedorId, order.id),
        inArray(schema.pedidoProveedor.pedidoProveedorEstado, [
          "pendiente",
          "parcial",
        ]),
      ),
    )
    .returning({ id: schema.pedidoProveedor.pedidoProveedorId });

  if (updatedOrder.length !== 1) {
    throw new SupplierOrderDomainError(
      "concurrency",
      "El estado del pedido cambió durante la recepción.",
    );
  }

  await executor.insert(schema.historialAuditoriaPedido).values({
    historialApTipoEvento: "recepcion",
    historialApNota: `Recepción ${receiptId}; operación ${payload.operacionId}; estado ${nextState}.`,
    pedidoProveedorId: order.id,
    usuarioId: user.usuarioId,
  });
  await registerAuditLog(executor, schema, {
    descripcion: `Recepción ${receiptId} registrada para pedido ${order.id}; estado ${nextState}.`,
    modulo: "proveedores",
    tipoAccion: "recepcion_pedido",
    usuarioId: user.usuarioId,
  });

  return {
    pedidoId: order.id,
    recepcionId: receiptId,
    operacionId: payload.operacionId,
    estado: nextState,
    idempotente: false,
  };
}

async function findExistingReception(
  executor: QueryExecutor,
  schema: SchemaLike,
  payload: SupplierOrderReceptionPayload,
): Promise<Omit<SupplierOrderReceptionResponse, "idempotente"> | null> {
  const rows = await executor
    .select({
      recepcionId: schema.recepcionPedido.recepcionPedidoId,
      pedidoId: schema.recepcionPedido.pedidoProveedorId,
      operacionId: schema.recepcionPedido.recepcionOperacionId,
      estado: schema.recepcionPedido.recepcionEstadoResultante,
    })
    .from(schema.recepcionPedido)
    .where(eq(schema.recepcionPedido.recepcionOperacionId, payload.operacionId))
    .limit(1);
  const existing = rows[0];

  if (!existing) return null;
  if (existing.pedidoId !== payload.pedidoId) {
    throw new SupplierOrderDomainError(
      "idempotency",
      "El identificador de operación ya pertenece a otro pedido.",
      { operacionId: "Genere un nuevo identificador de operación." },
    );
  }

  return existing;
}

async function cancelSupplierOrder(
  payload: SupplierOrderCancelPayload,
): Promise<SupplierOrderFinishResponse> {
  const { db, schema } = await import("../../db/client");
  const result = await db.transaction((tx) =>
    cancelSupplierOrderWithExecutor(tx, schema, payload),
  );
  notifySupplierOrdersUpdated();
  return result;
}

export async function cancelSupplierOrderWithExecutor(
  executor: MutationExecutor,
  schema: SchemaLike,
  payload: SupplierOrderCancelPayload,
): Promise<SupplierOrderFinishResponse> {
  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  const rows = await executor.all<{
    estado: SupplierOrderState;
    recibido: number;
    recepciones: number;
  }>(sql`
    SELECT
      pp.pedido_proveedor_estado AS estado,
      COALESCE(SUM(dp.cantidad_recibida), 0) AS recibido,
      (SELECT COUNT(*) FROM recepcion_pedido rp
        WHERE rp.pedido_proveedor_id = pp.pedido_proveedor_id) AS recepciones
    FROM pedido_proveedor pp
    LEFT JOIN detalle_pedido dp
      ON dp.pedido_proveedor_id = pp.pedido_proveedor_id
    WHERE pp.pedido_proveedor_id = ${payload.pedidoId}
    GROUP BY pp.pedido_proveedor_id, pp.pedido_proveedor_estado
  `);
  const order = rows[0];

  if (!order) {
    throw new SupplierOrderDomainError("not-found", "El pedido no existe.");
  }
  if (
    order.estado !== "pendiente" ||
    Number(order.recibido) !== 0 ||
    Number(order.recepciones) !== 0
  ) {
    throw new SupplierOrderDomainError(
      "state",
      "Solo se puede cancelar un pedido pendiente sin recepciones.",
    );
  }

  const updated = await executor
    .update(schema.pedidoProveedor)
    .set({ pedidoProveedorEstado: "cancelado" })
    .where(
      and(
        eq(schema.pedidoProveedor.pedidoProveedorId, payload.pedidoId),
        eq(schema.pedidoProveedor.pedidoProveedorEstado, "pendiente"),
      ),
    )
    .returning({ id: schema.pedidoProveedor.pedidoProveedorId });
  if (updated.length !== 1) {
    throw new SupplierOrderDomainError(
      "concurrency",
      "El estado del pedido cambió durante la cancelación.",
    );
  }

  await executor.insert(schema.historialAuditoriaPedido).values({
    historialApTipoEvento: "cancelacion",
    historialApNota: "Pedido cancelado sin recepciones ni cambios de stock.",
    pedidoProveedorId: payload.pedidoId,
    usuarioId: user.usuarioId,
  });
  await registerAuditLog(executor, schema, {
    descripcion: `Pedido ${payload.pedidoId} cancelado sin recepciones.`,
    modulo: "proveedores",
    tipoAccion: "cancelacion_pedido",
    usuarioId: user.usuarioId,
  });

  return { pedidoId: payload.pedidoId, estado: "cancelado" };
}

async function closeSupplierOrderBalance(
  payload: SupplierOrderClosePayload,
): Promise<SupplierOrderFinishResponse> {
  const { db, schema } = await import("../../db/client");
  const result = await db.transaction((tx) =>
    closeSupplierOrderBalanceWithExecutor(tx, schema, payload),
  );
  notifySupplierOrdersUpdated();
  return result;
}

export async function closeSupplierOrderBalanceWithExecutor(
  executor: MutationExecutor,
  schema: SchemaLike,
  payload: SupplierOrderClosePayload,
): Promise<SupplierOrderFinishResponse> {
  if (!payload.motivo.trim()) {
    throw new SupplierOrderDomainError(
      "validation",
      "Ingrese el motivo del cierre de saldo.",
      { motivo: "Ingrese el motivo del cierre de saldo." },
    );
  }

  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  const rows = await executor.all<{
    estado: SupplierOrderState;
    solicitado: number;
    recibido: number;
  }>(sql`
    SELECT
      pp.pedido_proveedor_estado AS estado,
      COALESCE(SUM(dp.cantidad_solicitada), 0) AS solicitado,
      COALESCE(SUM(dp.cantidad_recibida), 0) AS recibido
    FROM pedido_proveedor pp
    LEFT JOIN detalle_pedido dp
      ON dp.pedido_proveedor_id = pp.pedido_proveedor_id
    WHERE pp.pedido_proveedor_id = ${payload.pedidoId}
    GROUP BY pp.pedido_proveedor_id, pp.pedido_proveedor_estado
  `);
  const order = rows[0];
  const pending = order
    ? Number(order.solicitado) - Number(order.recibido)
    : 0;

  if (!order) {
    throw new SupplierOrderDomainError("not-found", "El pedido no existe.");
  }
  if (
    order.estado !== "parcial" ||
    Number(order.recibido) <= 0 ||
    pending <= 0
  ) {
    throw new SupplierOrderDomainError(
      "state",
      "Solo se puede cerrar el saldo de un pedido recibido parcialmente.",
    );
  }

  const updated = await executor
    .update(schema.pedidoProveedor)
    .set({
      pedidoProveedorEstado: "parcial_cerrado",
      pedidoProveedorNotaRecepcion: payload.motivo.trim(),
    })
    .where(
      and(
        eq(schema.pedidoProveedor.pedidoProveedorId, payload.pedidoId),
        eq(schema.pedidoProveedor.pedidoProveedorEstado, "parcial"),
      ),
    )
    .returning({ id: schema.pedidoProveedor.pedidoProveedorId });
  if (updated.length !== 1) {
    throw new SupplierOrderDomainError(
      "concurrency",
      "El estado del pedido cambió durante el cierre de saldo.",
    );
  }

  await executor.insert(schema.historialAuditoriaPedido).values({
    historialApTipoEvento: "cierre_saldo",
    historialApNota: `Motivo: ${payload.motivo.trim()}. Faltante conservado: ${pending}.`,
    pedidoProveedorId: payload.pedidoId,
    usuarioId: user.usuarioId,
  });
  await registerAuditLog(executor, schema, {
    descripcion: `Saldo pendiente del pedido ${payload.pedidoId} cerrado. Motivo: ${payload.motivo.trim()}.`,
    modulo: "proveedores",
    tipoAccion: "cierre_saldo_pedido",
    usuarioId: user.usuarioId,
  });

  return { pedidoId: payload.pedidoId, estado: "parcial_cerrado" };
}

function validateFinishInput(
  payload: SupplierOrderCancelPayload | SupplierOrderClosePayload,
): SupplierOrderFieldErrors {
  const errors: SupplierOrderFieldErrors = {};
  if (!isUuid(payload.pedidoId)) {
    errors.pedidoId = "Seleccione un pedido válido.";
  }
  if (!payload.confirmacion) {
    errors.confirmacion = "Confirme la operación antes de continuar.";
  }
  return errors;
}

function buildStateFilter(filter: "abiertos" | "terminados" | "todos"): SQL {
  if (filter === "abiertos") {
    return sql`WHERE pp.pedido_proveedor_estado IN ('pendiente','parcial')`;
  }
  if (filter === "terminados") {
    return sql`WHERE pp.pedido_proveedor_estado IN ('recibido','cancelado','parcial_cerrado')`;
  }
  return sql``;
}

function validationResponse(fieldErrors: SupplierOrderFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: "VALIDATION_ERROR" as const,
      controllerId: "supplier-order-reception" as const,
      fieldErrors,
      message: "Revise los campos marcados antes de continuar.",
    },
  };
}

function normalizeReceptionError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "supplier-order-reception" as const,
        message: error.message,
      },
    };
  }

  if (error instanceof SupplierOrderDomainError) {
    return {
      ok: false as const,
      error: {
        code:
          error.reason === "validation"
            ? ("VALIDATION_ERROR" as const)
            : error.reason === "not-found"
              ? ("NOT_FOUND" as const)
              : ("BUSINESS_RULE" as const),
        controllerId: "supplier-order-reception" as const,
        fieldErrors: error.fieldErrors,
        message: error.message,
      },
    };
  }

  return {
    ok: false as const,
    error: {
      code: "DATABASE_ERROR" as const,
      controllerId: "supplier-order-reception" as const,
      message: "No fue posible completar la operación sobre el pedido.",
    },
  };
}

function isUniqueOperationError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    text.includes("unique") &&
    (text.includes("recepcion_operacion_id") ||
      text.includes("recepcion_pedido.recepcion_operacion_id"))
  );
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function todayIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class SupplierOrderDomainError extends Error {
  constructor(
    readonly reason:
      | "validation"
      | "not-found"
      | "state"
      | "concurrency"
      | "idempotency",
    message: string,
    readonly fieldErrors: SupplierOrderFieldErrors = {},
  ) {
    super(message);
  }
}

export const supplierOrderReceptionController =
  createSupplierOrderReceptionController();
