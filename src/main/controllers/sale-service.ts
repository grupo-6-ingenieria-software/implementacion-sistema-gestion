import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  calculateCashChange,
  calculateSaleTotals,
  validateSaleDiscount,
  type SaleCartItemInput,
  type SaleCartValidationRequest,
  type SaleCartValidationResult,
  type SaleReceipt,
  type SaleReceiptLine,
  type SaleRegisterRequest,
} from "../../shared/sales";
import type { Role } from "../../shared/navigation";
import { INACTIVITY_MS } from "../../shared/auth";
import { getAuditTimestamp } from "../../shared/audit";
import {
  ensureDailyCashRegisterForSale,
  inspectDailyCashRegister,
} from "./cash-check";
import {
  applyStockDiscount,
  planStockDiscount,
  StockDiscountBusinessError,
} from "./stock-discount";
import { AccessDeniedError } from "./auth-context";

export type SaleRegisterItemInput = SaleCartItemInput;

export type SaleActor = {
  usuarioId: string;
  sesionId: string;
  rol: Role;
};

export type SaleProductSnapshot = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  precioUnitario: number;
  historialPrecioProductoId: string;
  stockDisponible: number;
  exigeVencimiento: boolean;
};

type DbRunResult = {
  rowsAffected?: number;
};

export type DbExecutor = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
  run: (query: SQL) => Promise<DbRunResult>;
  transaction: <T>(callback: (tx: DbExecutor) => Promise<T>) => Promise<T>;
};

export class SaleValidationError extends Error {}
export class SaleBusinessError extends Error {}

export async function getOpenCashRegister(
  database: DbExecutor,
  now = new Date(),
): Promise<{ cierreCajaId: string } | null> {
  const state = await ensureDailyCashRegisterForSale(database, now);
  return state.status === "abierta"
    ? { cierreCajaId: state.cierreCajaId }
    : null;
}

export async function registerSale(
  database: DbExecutor,
  payload: SaleRegisterRequest,
  actor: SaleActor,
  now = new Date(),
): Promise<SaleReceipt> {
  return database.transaction(async (tx) => {
    const responsable = await getResponsibleUser(tx, actor, now);
    const transactionCashState = await inspectDailyCashRegister(tx, now);
    if (transactionCashState.status === "cerrada") {
      throw new SaleBusinessError(
        "La caja de este día ya fue cerrada. No es posible registrar nuevas ventas.",
      );
    }
    await validateSalePayloadRules(tx, payload);
    const normalized = normalizeSalePayload(payload);
    const products = await loadProductSnapshots(tx, normalized.items);
    const receiptLines: SaleReceiptLine[] = products.map((product) => {
      const item = normalized.items.find(
        (current) => current.productoId === product.productoId,
      );

      if (!item) {
        throw new SaleValidationError("No fue posible preparar el carrito.");
      }

      if (item.ean13 && item.ean13 !== product.ean13) {
        throw new SaleValidationError(
          `El producto ${product.nombre} no coincide con el EAN-13 ingresado.`,
        );
      }

      return {
        ...product,
        cantidad: item.cantidad,
        subtotal: item.cantidad * product.precioUnitario,
        lotesConsumidos: [],
      };
    });

    const requestedDiscount = normalized.descuento?.monto ?? 0;
    const subtotal = calculateSaleTotals(receiptLines).subtotal;
    const discountErrors = validateSaleDiscount(
      requestedDiscount,
      normalized.descuento?.razon,
      subtotal,
    );
    if (discountErrors.monto || discountErrors.razon) {
      throw new SaleValidationError(
        discountErrors.monto ?? discountErrors.razon,
      );
    }
    const totals = calculateSaleTotals(receiptLines, requestedDiscount);

    await validateCalculatedSaleRules(
      tx,
      normalized,
      totals.subtotal,
      totals.total,
    );

    let stockPlan;
    try {
      stockPlan = await planStockDiscount(
        tx,
        receiptLines.map((line) => ({
          productoId: line.productoId,
          cantidad: line.cantidad,
          exigeVencimiento: line.exigeVencimiento,
        })),
      );
    } catch (error) {
      if (error instanceof StockDiscountBusinessError) {
        throw new SaleBusinessError(error.message);
      }
      throw error;
    }

    // Revalidación transaccional: el plan de stock se completa antes de abrir la
    // primera caja del día, por lo que un carrito inválido no genera escrituras.
    const cashState = await ensureDailyCashRegisterForSale(tx, now);
    if (cashState.status === "cerrada") {
      throw new SaleBusinessError(
        "La caja de este día ya fue cerrada. No es posible registrar nuevas ventas.",
      );
    }
    if (cashState.status !== "abierta") {
      throw new SaleBusinessError("No fue posible habilitar la caja del día.");
    }

    const ventaId = randomUUID();
    const fechaHora = now.toISOString();
    const descuentoTipo = totals.descuento > 0 ? "monto" : "ninguno";
    const descuentoValor = totals.descuento > 0 ? totals.descuento : null;
    const descuentoRazon =
      totals.descuento > 0
        ? (normalized.descuento?.razon.trim() ?? null)
        : null;
    const esEfectivo = normalized.metodoPago === "efectivo";

    await tx.run(sql`
      INSERT INTO venta (
        venta_id,
        venta_fecha_hora,
        venta_descuento_tipo,
        venta_descuento_valor,
        venta_descuento_razon,
        venta_metodo_pago,
        venta_estado,
        es_venta_efectivo,
        es_venta_electronica,
        usuario_cajero_id,
        venta_responsable_nombre,
        venta_responsable_rol,
        cierre_caja_id
      )
      VALUES (
        ${ventaId},
        ${fechaHora},
        ${descuentoTipo},
        ${descuentoValor},
        ${descuentoRazon},
        ${normalized.metodoPago},
        'completada',
        ${esEfectivo ? 1 : 0},
        ${esEfectivo ? 0 : 1},
        ${responsable.usuarioId},
        ${responsable.nombre},
        ${responsable.rol},
        ${cashState.cierreCajaId}
      )
    `);

    if (esEfectivo) {
      await tx.run(sql`
        INSERT INTO venta_efectivo (
          venta_id,
          venta_efectivo_monto_recibido
        )
        VALUES (${ventaId}, ${normalized.montoRecibido ?? 0})
      `);
    }

    for (const line of receiptLines) {
      await tx.run(sql`
        INSERT INTO detalle_venta (
          detalle_venta_id,
          venta_id,
          producto_id,
          detalle_venta_cantidad,
          historial_precio_producto_id
        )
        VALUES (
          ${randomUUID()},
          ${ventaId},
          ${line.productoId},
          ${line.cantidad},
          ${line.historialPrecioProductoId}
        )
      `);

      line.lotesConsumidos = stockPlan
        .filter((lot) => lot.productoId === line.productoId)
        .map(({ loteId, cantidad }) => ({ loteId, cantidad }));
    }

    try {
      await applyStockDiscount(tx, ventaId, stockPlan);
    } catch (error) {
      if (error instanceof StockDiscountBusinessError) {
        throw new SaleBusinessError(error.message);
      }
      throw error;
    }

    await registerAuditLog(tx, {
      usuarioId: responsable.usuarioId,
      tipoAccion: "registrar_venta",
      modulo: "ventas",
      descripcion: `Venta ${ventaId} registrada por ${responsable.nombre} por $${totals.total}.`,
    });

    return {
      ventaId,
      fechaHora,
      responsable,
      metodoPago: normalized.metodoPago,
      subtotal: totals.subtotal,
      descuento: {
        tipo: descuentoTipo,
        valor: totals.descuento,
        razon: descuentoRazon ?? undefined,
      },
      total: totals.total,
      montoRecibido: esEfectivo ? normalized.montoRecibido : undefined,
      vuelto: esEfectivo
        ? calculateCashChange(totals.total, normalized.montoRecibido ?? 0)
        : undefined,
      detalle: receiptLines,
    };
  });
}

/** Validación remota y de solo lectura usada mientras se edita el carrito. */
export async function validateSaleCart(
  database: Pick<DbExecutor, "all">,
  payload: SaleCartValidationRequest,
): Promise<SaleCartValidationResult> {
  await validateCartItemRules(database, payload?.items);
  const items = normalizeCartItems(payload?.items);
  const products = await loadProductSnapshots(database, items);
  const lines: SaleCartValidationResult["lines"] = [];
  for (const product of products) {
    const item = items.find(
      (candidate) => candidate.productoId === product.productoId,
    );
    if (!item)
      throw new SaleValidationError("No fue posible validar el carrito.");
    const matches = await database.all<{ accepted: number }>(sql`
      SELECT 1 AS accepted
      FROM producto
      WHERE producto_id = ${item.productoId}
        AND producto_estado = 'activo'
        AND (${item.ean13 ?? null} IS NULL OR producto_ean_13 = ${item.ean13 ?? null})
        AND (
          SELECT COALESCE(SUM(lote_cantidad_actual), 0)
          FROM lote
          WHERE producto_id = ${item.productoId}
        ) >= ${item.cantidad}
    `);
    if (!matches[0] && item.ean13 && item.ean13 !== product.ean13) {
      throw new SaleValidationError(
        `El producto ${product.nombre} no coincide con el EAN-13 ingresado.`,
      );
    }
    if (!matches[0]) {
      throw new SaleBusinessError(
        `Stock insuficiente para ${product.nombre}. Disponible: ${product.stockDisponible}.`,
      );
    }
    lines.push({
      productoId: product.productoId,
      ean13: product.ean13,
      nombre: product.nombre,
      categoria: product.categoria,
      cantidad: item.cantidad,
      precioUnitario: product.precioUnitario,
      stockDisponible: product.stockDisponible,
      subtotal: item.cantidad * product.precioUnitario,
    });
  }
  return {
    lines,
    subtotal: lines.reduce((total, line) => total + line.subtotal, 0),
  };
}

async function validateSalePayloadRules(
  database: Pick<DbExecutor, "all">,
  payload: SaleRegisterRequest,
): Promise<void> {
  const record =
    payload && typeof payload === "object"
      ? (payload as unknown as Record<string, unknown>)
      : {};
  const method =
    typeof record.metodoPago === "string" ? record.metodoPago : null;
  const itemsJson = safeJson(record.items);
  const rows = await database.all<{ accepted: number }>(sql`
    SELECT 1 AS accepted
    WHERE ${method} IN ('efectivo', 'debito', 'credito', 'transferencia')
      AND json_valid(${itemsJson})
      AND json_type(${itemsJson}) = 'array'
      AND json_array_length(${itemsJson}) > 0
  `);
  if (!rows[0]) {
    if (
      !method ||
      !["efectivo", "debito", "credito", "transferencia"].includes(method)
    ) {
      throw new SaleValidationError("Seleccione un método de pago válido.");
    }
    throw new SaleValidationError("Agregue al menos un producto al carrito.");
  }
  await validateCartItemRules(
    database,
    Array.isArray(record.items)
      ? (record.items as SaleCartItemInput[])
      : undefined,
  );

  const hasDiscount =
    record.descuento !== undefined && record.descuento !== null;
  const discountShapeValid =
    !hasDiscount ||
    (typeof record.descuento === "object" && !Array.isArray(record.descuento));
  const discount =
    discountShapeValid && hasDiscount
      ? (record.descuento as Record<string, unknown>)
      : undefined;
  const discountAmount = bindableNumber(hasDiscount ? discount?.monto : 0);
  const discountReason =
    typeof discount?.razon === "string" ? discount.razon : null;
  const received = bindableNumber(record.montoRecibido);
  const numeric = await database.all<{
    discountValid: number;
    receivedValid: number;
  }>(sql`
    SELECT
      CASE WHEN ${discountShapeValid ? 1 : 0} = 1
        AND typeof(${discountAmount}) IN ('integer', 'real')
        AND CAST(${discountAmount} AS INTEGER) = ${discountAmount}
        AND ${discountAmount} >= 0
        AND ${discountAmount} <= ${Number.MAX_SAFE_INTEGER}
        AND (${discountAmount} = 0 OR length(trim(${discountReason})) > 0)
        THEN 1 ELSE 0 END AS discountValid,
      CASE WHEN ${method} <> 'efectivo' OR (
        typeof(${received}) IN ('integer', 'real')
        AND CAST(${received} AS INTEGER) = ${received}
        AND ${received} >= 0
      ) THEN 1 ELSE 0 END AS receivedValid
  `);
  if (!numeric[0]?.discountValid) {
    throw new SaleValidationError(
      discountAmount !== null && discountAmount > 0 && !discountReason?.trim()
        ? "La razón del descuento es obligatoria cuando se aplica un descuento."
        : "El descuento debe ser un monto entero mayor o igual a cero.",
    );
  }
  if (!numeric[0]?.receivedValid) {
    throw new SaleValidationError(
      "Ingrese un monto recibido válido para el pago en efectivo.",
    );
  }
}

async function validateCartItemRules(
  database: Pick<DbExecutor, "all">,
  items: readonly SaleCartItemInput[] | undefined,
): Promise<void> {
  const list = Array.isArray(items) ? items : [];
  const shape = await database.all<{ accepted: number }>(sql`
    SELECT 1 AS accepted WHERE ${list.length} > 0
  `);
  if (!shape[0])
    throw new SaleValidationError("Agregue al menos un producto al carrito.");
  for (const item of list) {
    const productId = bindableNumber(
      (item as SaleCartItemInput | undefined)?.productoId,
    );
    const quantity = bindableNumber(
      (item as SaleCartItemInput | undefined)?.cantidad,
    );
    const rawEan13 = (item as SaleCartItemInput | undefined)?.ean13;
    const ean13ShapeValid =
      rawEan13 === undefined ||
      rawEan13 === null ||
      typeof rawEan13 === "string";
    const ean13 = typeof rawEan13 === "string" ? rawEan13 : null;
    const valid = await database.all<{ accepted: number }>(sql`
      SELECT 1 AS accepted
      WHERE typeof(${productId}) IN ('integer', 'real')
        AND CAST(${productId} AS INTEGER) = ${productId}
        AND ${productId} > 0
        AND typeof(${quantity}) IN ('integer', 'real')
        AND CAST(${quantity} AS INTEGER) = ${quantity}
        AND ${quantity} > 0
        AND ${ean13ShapeValid ? 1 : 0} = 1
        AND (${ean13} IS NULL OR length(trim(${ean13})) > 0)
    `);
    if (!valid[0]) {
      if (!ean13ShapeValid || (ean13 !== null && !ean13.trim())) {
        throw new SaleValidationError(
          "El EAN-13 del carrito debe ser un texto válido.",
        );
      }
      if (!Number.isInteger(productId) || Number(productId) <= 0) {
        throw new SaleValidationError(
          "El carrito contiene un producto inválido.",
        );
      }
      throw new SaleValidationError(
        "La cantidad de cada producto debe ser un número entero mayor a cero.",
      );
    }
  }
}

async function validateCalculatedSaleRules(
  database: Pick<DbExecutor, "all">,
  payload: SaleRegisterRequest,
  subtotal: number,
  total: number,
): Promise<void> {
  const discount = payload.descuento?.monto ?? 0;
  const reason = payload.descuento?.razon ?? "";
  const received = payload.montoRecibido ?? null;
  const rows = await database.all<{ accepted: number }>(sql`
    SELECT 1 AS accepted
    WHERE ${discount} <= ${subtotal}
      AND (${discount} = 0 OR length(trim(${reason})) > 0)
      AND (${payload.metodoPago} <> 'efectivo' OR ${received} >= ${total})
  `);
  if (rows[0]) return;
  if (discount > subtotal)
    throw new SaleValidationError(
      "El descuento no puede ser mayor al subtotal de la venta.",
    );
  if (discount > 0 && !reason.trim())
    throw new SaleValidationError(
      "La razón del descuento es obligatoria cuando se aplica un descuento.",
    );
  throw new SaleBusinessError(
    "El monto recibido es insuficiente para confirmar la venta.",
  );
}

function bindableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}

export async function registerAuditLog(
  database: DbExecutor,
  input: {
    usuarioId: string;
    tipoAccion: string;
    modulo: string;
    descripcion: string;
  },
): Promise<void> {
  const usuarioVersionId = await getOrCreateCurrentUserVersion(
    database,
    input.usuarioId,
  );

  await database.run(sql`
    INSERT INTO log_auditoria (
      log_auditoria_id,
      log_fecha_hora,
      log_tipo_accion,
      log_modulo,
      log_descripcion,
      usuario_version_id
    )
    VALUES (
      ${randomUUID()},
      ${getAuditTimestamp()},
      ${input.tipoAccion},
      ${input.modulo},
      ${input.descripcion},
      ${usuarioVersionId}
    )
  `);
}

async function getResponsibleUser(
  database: DbExecutor,
  actor: SaleActor,
  now: Date,
): Promise<SaleReceipt["responsable"]> {
  if (
    !actor.usuarioId?.trim() ||
    !actor.sesionId?.trim() ||
    (actor.rol !== "dueno" && actor.rol !== "trabajador")
  ) {
    throw new AccessDeniedError(
      "No hay una sesión válida para registrar la venta.",
    );
  }

  const inactivityBoundary = new Date(
    now.getTime() - INACTIVITY_MS,
  ).toISOString();
  const users = await database.all<{
    usuarioId: string;
    sesionFechaHoraCierre: string | null;
    sesionVigente: number;
    trabajadorEstado: string;
    nombre: string;
  }>(sql`
    SELECT
      s.usuario_id AS usuarioId,
      s.sesion_fecha_hora_cierre AS sesionFechaHoraCierre,
      CASE
        WHEN julianday(s.sesion_fecha_hora_ultimo_acceso) IS NOT NULL
          AND julianday(s.sesion_fecha_hora_ultimo_acceso) > julianday(${inactivityBoundary})
        THEN 1 ELSE 0
      END AS sesionVigente,
      t.trabajador_estado AS trabajadorEstado,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombre
    FROM sesion_usuario s
    JOIN usuario u ON u.usuario_id = s.usuario_id
    JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE s.sesion_usuario_id = ${actor.sesionId}
    LIMIT 1
  `);
  const user = users[0];

  if (
    !user ||
    user.usuarioId !== actor.usuarioId.trim() ||
    user.sesionFechaHoraCierre !== null ||
    Number(user.sesionVigente) !== 1 ||
    user.trabajadorEstado !== "activo" ||
    !user.nombre.trim()
  ) {
    throw new AccessDeniedError(
      "El usuario autenticado no está activo o la sesión ya no es válida.",
    );
  }

  return {
    usuarioId: user.usuarioId,
    rol: actor.rol,
    nombre: user.nombre,
  };
}

async function getOrCreateCurrentUserVersion(
  database: DbExecutor,
  usuarioId: string,
): Promise<string> {
  const existing = await database.all<{ usuarioVersionId: string }>(sql`
    SELECT usuario_version_id AS usuarioVersionId
    FROM usuario_version
    WHERE usuario_id = ${usuarioId}
      AND usuario_version_fecha_hora_vigencia_hasta IS NULL
    ORDER BY usuario_version_fecha_hora_vigencia_desde DESC
    LIMIT 1
  `);

  if (existing[0]) {
    return existing[0].usuarioVersionId;
  }

  const users = await database.all<{
    nombre: string;
    rol: string;
  }>(sql`
    SELECT
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombre,
      u.usuario_rol AS rol
    FROM usuario u
    JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE u.usuario_id = ${usuarioId}
      AND t.trabajador_estado = 'activo'
    LIMIT 1
  `);
  const user = users[0];
  if (
    !user ||
    !user.nombre.trim() ||
    typeof user.rol !== "string" ||
    !user.rol.trim()
  ) {
    throw new AccessDeniedError(
      "No fue posible identificar al usuario responsable de la venta.",
    );
  }
  const usuarioVersionId = randomUUID();

  await database.run(sql`
    INSERT INTO usuario_version (
      usuario_version_id,
      usuario_version_nombre,
      usuario_version_rol,
      usuario_version_fecha_hora_vigencia_desde,
      usuario_version_fecha_hora_vigencia_hasta,
      usuario_id
    )
    VALUES (
      ${usuarioVersionId},
      ${user.nombre},
      ${user.rol},
      ${getAuditTimestamp()},
      NULL,
      ${usuarioId}
    )
  `);

  return usuarioVersionId;
}

function normalizeSalePayload(
  payload: SaleRegisterRequest,
): SaleRegisterRequest {
  const items = normalizeCartItems(payload.items);

  const descuentoMonto = payload.descuento?.monto ?? 0;

  return {
    ...payload,
    items,
    descuento:
      descuentoMonto > 0
        ? {
            monto: descuentoMonto,
            razon: payload.descuento?.razon ?? "",
          }
        : undefined,
  };
}

function normalizeCartItems(
  items: readonly SaleCartItemInput[] | undefined,
): SaleRegisterItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new SaleValidationError("Agregue al menos un producto al carrito.");
  }
  const itemsByProduct = new Map<number, SaleRegisterItemInput>();
  for (const item of items) {
    const productoId = Number(item.productoId);
    const cantidad = Number(item.cantidad);

    const existing = itemsByProduct.get(productoId);
    itemsByProduct.set(productoId, {
      productoId,
      ean13: item.ean13,
      cantidad: (existing?.cantidad ?? 0) + cantidad,
    });
  }
  return [...itemsByProduct.values()];
}

async function loadProductSnapshots(
  database: Pick<DbExecutor, "all">,
  items: readonly SaleRegisterItemInput[],
): Promise<SaleProductSnapshot[]> {
  const products: SaleProductSnapshot[] = [];

  for (const item of items) {
    const productRows = await database.all<{
      productoId: number;
      ean13: string;
      nombre: string;
      categoriaId: number;
      productoPrecioVenta: number;
    }>(sql`
      SELECT
        producto_id AS productoId,
        producto_ean_13 AS ean13,
        producto_nombre AS nombre,
        categoria_id AS categoriaId,
        producto_precio_venta AS productoPrecioVenta
      FROM producto
      WHERE producto_id = ${item.productoId}
        AND producto_estado = 'activo'
      LIMIT 1
    `);
    const product = productRows[0];

    if (!product) {
      throw new SaleValidationError(
        "El producto no existe o se encuentra inactivo.",
      );
    }

    const categories = await database.all<{
      categoria: string;
      exigeVencimiento: number;
    }>(sql`
      SELECT categoria_nombre AS categoria,
        categoria_exige_vencimiento AS exigeVencimiento
      FROM categoria
      WHERE categoria_id = ${product.categoriaId}
      LIMIT 1
    `);
    const category = categories[0];
    if (!category) {
      throw new SaleValidationError("La categoría del producto no existe.");
    }
    const prices = await database.all<{
      historialPrecioProductoId: string;
      precioUnitario: number;
    }>(sql`
      SELECT historial_precio_producto_id AS historialPrecioProductoId,
        historial_precio_venta AS precioUnitario
      FROM historial_precio_producto
      WHERE producto_id = ${product.productoId}
        AND historial_fecha_hora_vigencia_hasta IS NULL
      ORDER BY historial_fecha_hora_vigencia_desde DESC
      LIMIT 1
    `);
    const price = prices[0];
    if (!price) {
      throw new SaleBusinessError(
        `El producto ${product.nombre} no tiene un precio vigente registrado.`,
      );
    }
    const stocks = await database.all<{ stockDisponible: number }>(sql`
      SELECT COALESCE(SUM(lote_cantidad_actual), 0) AS stockDisponible
      FROM lote
      WHERE producto_id = ${product.productoId}
    `);

    products.push({
      productoId: Number(product.productoId),
      ean13: product.ean13,
      nombre: product.nombre,
      categoria: category.categoria,
      precioUnitario: Number(
        price.precioUnitario ?? product.productoPrecioVenta,
      ),
      historialPrecioProductoId: price.historialPrecioProductoId,
      stockDisponible: Number(stocks[0]?.stockDisponible ?? 0),
      exigeVencimiento: Boolean(category.exigeVencimiento),
    });
  }

  return products;
}
