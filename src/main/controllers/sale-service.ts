import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import {
  calculateCashChange,
  calculateSaleTotals,
  type PaymentMethod,
} from '../../shared/sales';

export type SaleRegisterItemInput = {
  productoId: number;
  ean13?: string;
  cantidad: number;
};

export type SaleRegisterPayload = {
  usuarioId: string;
  items: SaleRegisterItemInput[];
  metodoPago: PaymentMethod;
  montoRecibido?: number;
  descuento?: {
    monto: number;
    razon: string;
  };
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

export type ConsumedLot = {
  loteId: string;
  cantidad: number;
};

export type SaleReceiptLine = SaleProductSnapshot & {
  cantidad: number;
  subtotal: number;
  lotesConsumidos: ConsumedLot[];
};

export type SaleReceipt = {
  ventaId: string;
  fechaHora: string;
  responsable: {
    usuarioId: string;
    nombre: string;
    rol: string;
  };
  metodoPago: PaymentMethod;
  subtotal: number;
  descuento: {
    tipo: 'ninguno' | 'monto';
    valor: number;
    razon?: string;
  };
  total: number;
  montoRecibido?: number;
  vuelto?: number;
  detalle: SaleReceiptLine[];
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

export async function registerSale(
  database: DbExecutor,
  payload: SaleRegisterPayload,
): Promise<SaleReceipt> {
  const normalized = normalizeSalePayload(payload);

  return database.transaction(async (tx) => {
    const openCash = await getOpenCashRegister(tx);

    if (!openCash) {
      throw new SaleBusinessError(
        'La caja se encuentra cerrada. Abra una caja antes de registrar ventas.',
      );
    }

    const responsable = await getResponsibleUser(tx, normalized.usuarioId);
    const products = await loadProductSnapshots(tx, normalized.items);
    const receiptLines: SaleReceiptLine[] = products.map((product) => {
      const item = normalized.items.find(
        (current) => current.productoId === product.productoId,
      );

      if (!item) {
        throw new SaleValidationError('No fue posible preparar el carrito.');
      }

      if (item.ean13 && item.ean13 !== product.ean13) {
        throw new SaleValidationError(
          `El producto ${product.nombre} no coincide con el EAN-13 ingresado.`,
        );
      }

      if (product.stockDisponible < item.cantidad) {
        throw new SaleBusinessError(
          `Stock insuficiente para ${product.nombre}. Disponible: ${product.stockDisponible}.`,
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
    const totals = calculateSaleTotals(receiptLines, requestedDiscount);

    if (requestedDiscount > totals.subtotal) {
      throw new SaleValidationError(
        'El descuento no puede ser mayor al subtotal de la venta.',
      );
    }

    if (requestedDiscount > 0 && !normalized.descuento?.razon.trim()) {
      throw new SaleValidationError(
        'La razón del descuento es obligatoria cuando se aplica un descuento.',
      );
    }

    if (
      normalized.metodoPago === 'efectivo' &&
      (normalized.montoRecibido === undefined ||
        normalized.montoRecibido < totals.total)
    ) {
      throw new SaleBusinessError(
        'El monto recibido es insuficiente para confirmar la venta.',
      );
    }

    const ventaId = randomUUID();
    const fechaHora = new Date().toISOString();
    const descuentoTipo = totals.descuento > 0 ? 'monto' : 'ninguno';
    const descuentoValor = totals.descuento > 0 ? totals.descuento : null;
    const descuentoRazon =
      totals.descuento > 0 ? normalized.descuento?.razon.trim() ?? null : null;
    const esEfectivo = normalized.metodoPago === 'efectivo';

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
        ${normalized.usuarioId},
        ${openCash.cierreCajaId}
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

      line.lotesConsumidos = await consumeStockForSale(
        tx,
        ventaId,
        line.productoId,
        line.cantidad,
        line.exigeVencimiento,
      );
    }

    await registerAuditLog(tx, {
      usuarioId: normalized.usuarioId,
      tipoAccion: 'registrar_venta',
      modulo: 'ventas',
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

export async function consumeStockForSale(
  tx: DbExecutor,
  ventaId: string,
  productoId: number,
  cantidadSolicitada: number,
  exigeVencimiento: boolean,
): Promise<ConsumedLot[]> {
  const lots = await tx.all<{
    loteId: string;
    cantidadActual: number;
    fechaIngreso: string;
    fechaVencimiento: string | null;
  }>(sql`
    SELECT
      l.lote_id AS loteId,
      l.lote_cantidad_actual AS cantidadActual,
      l.lote_fecha_hora_ingreso AS fechaIngreso,
      lp.lote_perecible_fecha_vencimiento AS fechaVencimiento
    FROM lote l
    LEFT JOIN lote_perecible lp ON lp.lote_id = l.lote_id
    WHERE l.producto_id = ${productoId}
      AND l.lote_cantidad_actual > 0
  `);

  const orderedLots = [...lots].sort((left, right) => {
    if (exigeVencimiento) {
      const leftDate = left.fechaVencimiento ?? '9999-12-31';
      const rightDate = right.fechaVencimiento ?? '9999-12-31';

      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
    }

    return left.fechaIngreso.localeCompare(right.fechaIngreso);
  });

  const consumed: ConsumedLot[] = [];
  let remaining = cantidadSolicitada;

  for (const lot of orderedLots) {
    if (remaining === 0) {
      break;
    }

    const amount = Math.min(remaining, Number(lot.cantidadActual));

    if (amount <= 0) {
      continue;
    }

    await tx.run(sql`
      INSERT INTO venta_lote (
        venta_lote_id,
        venta_id,
        lote_id,
        venta_lote_cantidad_consumida
      )
      VALUES (${randomUUID()}, ${ventaId}, ${lot.loteId}, ${amount})
    `);

    const result = await tx.run(sql`
      UPDATE lote
      SET lote_cantidad_actual = lote_cantidad_actual - ${amount}
      WHERE lote_id = ${lot.loteId}
        AND lote_cantidad_actual >= ${amount}
    `);

    if (result.rowsAffected === 0) {
      throw new SaleBusinessError(
        'El stock cambió durante la operación. Revise el carrito e intente nuevamente.',
      );
    }

    consumed.push({ loteId: lot.loteId, cantidad: amount });
    remaining -= amount;
  }

  if (remaining > 0) {
    throw new SaleBusinessError(
      'Stock insuficiente para confirmar la venta.',
    );
  }

  return consumed;
}

export async function getOpenCashRegister(
  database: DbExecutor,
): Promise<{ cierreCajaId: string } | null> {
  const rows = await database.all<{ cierreCajaId: string }>(sql`
    SELECT cierre_caja_id AS cierreCajaId
    FROM cierre_caja
    WHERE cierre_estado = 'abierto'
    ORDER BY cierre_fecha_hora_inicio DESC
    LIMIT 1
  `);

  return rows[0] ?? null;
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
      ${new Date().toISOString()},
      ${input.tipoAccion},
      ${input.modulo},
      ${input.descripcion},
      ${usuarioVersionId}
    )
  `);
}

async function getResponsibleUser(
  database: DbExecutor,
  usuarioId: string,
): Promise<SaleReceipt['responsable']> {
  const rows = await database.all<{
    usuarioId: string;
    rol: string;
    nombre: string;
  }>(sql`
    SELECT
      u.usuario_id AS usuarioId,
      u.usuario_rol AS rol,
      t.trabajador_nombre || ' ' || t.trabajador_apellido AS nombre
    FROM usuario u
    INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE u.usuario_id = ${usuarioId}
      AND t.trabajador_estado = 'activo'
    LIMIT 1
  `);

  const user = rows[0];

  if (!user) {
    throw new SaleValidationError(
      'No fue posible identificar al trabajador responsable de la venta.',
    );
  }

  return user;
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

  const user = await getResponsibleUser(database, usuarioId);
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
      ${new Date().toISOString()},
      NULL,
      ${usuarioId}
    )
  `);

  return usuarioVersionId;
}

function normalizeSalePayload(payload: SaleRegisterPayload): SaleRegisterPayload {
  if (!payload || typeof payload !== 'object') {
    throw new SaleValidationError('La venta no contiene datos válidos.');
  }

  if (!payload.usuarioId?.trim()) {
    throw new SaleValidationError('No hay un usuario responsable para la venta.');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new SaleValidationError('Agregue al menos un producto al carrito.');
  }

  if (!['efectivo', 'debito', 'credito', 'transferencia'].includes(payload.metodoPago)) {
    throw new SaleValidationError('Seleccione un método de pago válido.');
  }

  const itemsByProduct = new Map<number, SaleRegisterItemInput>();

  for (const item of payload.items) {
    const productoId = Number(item.productoId);
    const cantidad = Number(item.cantidad);

    if (!Number.isInteger(productoId) || productoId <= 0) {
      throw new SaleValidationError('El carrito contiene un producto inválido.');
    }

    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new SaleValidationError(
        'La cantidad de cada producto debe ser un número entero mayor a cero.',
      );
    }

    const existing = itemsByProduct.get(productoId);
    itemsByProduct.set(productoId, {
      productoId,
      ean13: item.ean13,
      cantidad: (existing?.cantidad ?? 0) + cantidad,
    });
  }

  const descuentoMonto = payload.descuento?.monto ?? 0;

  if (!Number.isInteger(descuentoMonto) || descuentoMonto < 0) {
    throw new SaleValidationError('El descuento debe ser un monto entero mayor o igual a cero.');
  }

  if (
    payload.metodoPago === 'efectivo' &&
    (payload.montoRecibido === undefined ||
      !Number.isInteger(payload.montoRecibido) ||
      payload.montoRecibido < 0)
  ) {
    throw new SaleValidationError(
      'Ingrese un monto recibido válido para el pago en efectivo.',
    );
  }

  return {
    ...payload,
    usuarioId: payload.usuarioId.trim(),
    items: [...itemsByProduct.values()],
    descuento:
      descuentoMonto > 0
        ? {
            monto: descuentoMonto,
            razon: payload.descuento?.razon ?? '',
          }
        : undefined,
  };
}

async function loadProductSnapshots(
  database: DbExecutor,
  items: readonly SaleRegisterItemInput[],
): Promise<SaleProductSnapshot[]> {
  const products: SaleProductSnapshot[] = [];

  for (const item of items) {
    const rows = await database.all<{
      productoId: number;
      ean13: string;
      nombre: string;
      categoria: string;
      precioUnitario: number | null;
      productoPrecioVenta: number;
      historialPrecioProductoId: string | null;
      stockDisponible: number;
      exigeVencimiento: number;
    }>(sql`
      SELECT
        p.producto_id AS productoId,
        p.producto_ean_13 AS ean13,
        p.producto_nombre AS nombre,
        c.categoria_nombre AS categoria,
        hp.historial_precio_venta AS precioUnitario,
        p.producto_precio_venta AS productoPrecioVenta,
        hp.historial_precio_producto_id AS historialPrecioProductoId,
        (
          SELECT COALESCE(SUM(l.lote_cantidad_actual), 0)
          FROM lote l
          WHERE l.producto_id = p.producto_id
        ) AS stockDisponible,
        c.categoria_exige_vencimiento AS exigeVencimiento
      FROM producto p
      INNER JOIN categoria c ON c.categoria_id = p.categoria_id
      LEFT JOIN historial_precio_producto hp
        ON hp.historial_precio_producto_id = (
          SELECT h.historial_precio_producto_id
          FROM historial_precio_producto h
          WHERE h.producto_id = p.producto_id
            AND h.historial_fecha_hora_vigencia_hasta IS NULL
          ORDER BY h.historial_fecha_hora_vigencia_desde DESC
          LIMIT 1
        )
      WHERE p.producto_id = ${item.productoId}
        AND p.producto_estado = 'activo'
      LIMIT 1
    `);

    const product = rows[0];

    if (!product) {
      throw new SaleValidationError('El producto no existe o se encuentra inactivo.');
    }

    if (!product.historialPrecioProductoId) {
      throw new SaleBusinessError(
        `El producto ${product.nombre} no tiene un precio vigente registrado.`,
      );
    }

    products.push({
      productoId: Number(product.productoId),
      ean13: product.ean13,
      nombre: product.nombre,
      categoria: product.categoria,
      precioUnitario: Number(product.precioUnitario ?? product.productoPrecioVenta),
      historialPrecioProductoId: product.historialPrecioProductoId,
      stockDisponible: Number(product.stockDisponible),
      exigeVencimiento: Boolean(product.exigeVencimiento),
    });
  }

  return products;
}
