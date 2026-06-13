import { and, eq, sql } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import {
  hasWasteFieldErrors,
  isWasteReason,
  normalizeWasteRegisterPayload,
  validateWasteRegisterPayload,
  type WasteDiscountedLot,
  type WasteFieldErrors,
  type WasteRegisterPayload,
  type WasteRegisterResponse,
} from '../../shared/waste';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';
import { notifyDashboardUpdated } from './dashboard-events';

type WasteDependencies = {
  register: (payload: WasteRegisterPayload) => Promise<WasteRegisterResponse>;
};

type ProductForWaste = {
  productoId: number;
  exigeVencimiento: boolean;
  nombre: string;
};

type AvailableLot = {
  loteId: string;
  cantidadActual: number;
  fechaIngreso: string;
  fechaVencimiento: string | null;
};

export function createWasteController(
  dependencies: WasteDependencies = wasteDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, WasteRegisterResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel !== 'merma:registrar') {
      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'waste',
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const input = normalizeWasteRegisterPayload(payload);
    const fieldErrors = validateWasteRegisterPayload(input, {
      requireUser: true,
    });

    if (hasWasteFieldErrors(fieldErrors)) {
      return validationResponse(fieldErrors);
    }

    try {
      return {
        ok: true,
        data: await dependencies.register(input),
      };
    } catch (error) {
      const knownError = normalizeWasteError(error);

      if (knownError) {
        return knownError;
      }

      return {
        ok: false,
        error: {
          code: 'DATABASE_ERROR',
          controllerId: 'waste',
          message: 'No fue posible registrar la merma. Intente nuevamente.',
        },
      };
    }
  };

  return {
    metadata: controllers[14],
    handle,
  };
}

const wasteDependencies: WasteDependencies = {
  register: registerWaste,
};

async function registerWaste(
  payload: WasteRegisterPayload,
): Promise<WasteRegisterResponse> {
  const { db, schema } = await import('../../db/client');
  let result: WasteRegisterResponse | undefined;

  await db.transaction(async (tx) => {
    result = await registerWasteWithExecutor(tx, schema, payload);
  });

  if (!result) {
    throw new Error('Waste registration did not return a result.');
  }

  notifyDashboardUpdated();

  return result;
}

export async function registerWasteWithExecutor(
  executor: MutationExecutor,
  schema: SchemaLike,
  payload: WasteRegisterPayload,
): Promise<WasteRegisterResponse> {
  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    'dueno',
    'trabajador',
  ]);
  const product = await findActiveProductByEan13(
    executor,
    schema,
    payload.ean13,
  );

  if (!product) {
    throw new WasteError('product-not-found', {
      ean13: 'El producto no existe o se encuentra inactivo.',
    });
  }

  const lots = await findAvailableLotsForProduct(
    executor,
    schema,
    product.productoId,
  );
  const stockDisponible = lots.reduce(
    (total, lot) => total + lot.cantidadActual,
    0,
  );
  const fieldErrors = validateWasteRegisterPayload(payload, {
    requireUser: true,
    stockDisponible,
  });

  if (hasWasteFieldErrors(fieldErrors)) {
    throw new WasteError(
      stockDisponible < payload.cantidad ? 'stock-insufficient' : 'validation',
      fieldErrors,
    );
  }

  if (!isWasteReason(payload.motivo)) {
    throw new WasteError('validation', {
      motivo: 'Seleccione un motivo de merma valido.',
    });
  }

  const [createdMerma] = await executor
    .insert(schema.merma)
    .values({
      mermaMotivo: payload.motivo,
      mermaObservacion: payload.observacion ?? null,
      productoId: product.productoId,
      usuarioId: user.usuarioId,
    })
    .returning({ mermaId: schema.merma.mermaId });

  const lotesDescontados = await discountWasteLots(
    executor,
    schema,
    {
      mermaId: createdMerma.mermaId,
      product,
      usuarioId: user.usuarioId,
      ean13: payload.ean13,
      motivo: payload.motivo,
    },
    lots,
    payload.cantidad,
  );

  await registerAuditLog(executor, schema, {
    tipoAccion: 'registro',
    modulo: 'inventario',
    descripcion: `Merma registrada para producto ${payload.ean13} (${payload.cantidad} unidades).`,
    usuarioId: user.usuarioId,
  });

  return {
    mermaId: createdMerma.mermaId,
    ean13: payload.ean13,
    cantidad: payload.cantidad,
    lotesDescontados,
  };
}

async function discountWasteLots(
  executor: MutationExecutor,
  schema: SchemaLike,
  context: {
    ean13: string;
    mermaId: string;
    motivo: string;
    product: ProductForWaste;
    usuarioId: string;
  },
  lots: AvailableLot[],
  cantidad: number,
): Promise<WasteDiscountedLot[]> {
  const orderedLots = [...lots].sort((left, right) => {
    if (context.product.exigeVencimiento) {
      const leftDate = left.fechaVencimiento ?? '9999-12-31';
      const rightDate = right.fechaVencimiento ?? '9999-12-31';

      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
    }

    return left.fechaIngreso.localeCompare(right.fechaIngreso);
  });

  const discountedLots: WasteDiscountedLot[] = [];
  let remaining = cantidad;

  for (const lot of orderedLots) {
    if (remaining === 0) {
      break;
    }

    const amount = Math.min(remaining, lot.cantidadActual);

    if (amount <= 0) {
      continue;
    }

    await executor.insert(schema.mermaLote).values({
      mermaId: context.mermaId,
      loteId: lot.loteId,
      mermaLoteCantidadDescontada: amount,
    });

    const updatedLots = await executor
      .update(schema.lote)
      .set({
        loteCantidadActual: sql`${schema.lote.loteCantidadActual} - ${amount}`,
      })
      .where(
        and(
          eq(schema.lote.loteId, lot.loteId),
          sql`${schema.lote.loteCantidadActual} >= ${amount}`,
        ),
      )
      .returning({ loteId: schema.lote.loteId });

    if (updatedLots.length === 0) {
      throw new WasteError('stock-changed', {
        cantidad:
          'El stock cambio durante la operacion. Revise el producto e intente nuevamente.',
      });
    }

    await executor.insert(schema.ajusteInventario).values({
      ajusteCantidad: -amount,
      ajusteJustificacion: `Merma por ${context.motivo} para ${context.ean13}`,
      productoId: context.product.productoId,
      loteId: lot.loteId,
      usuarioId: context.usuarioId,
    });

    discountedLots.push({ loteId: lot.loteId, cantidad: amount });
    remaining -= amount;
  }

  if (remaining > 0) {
    throw new WasteError('stock-insufficient', {
      cantidad: 'El stock disponible no alcanza para registrar la merma.',
    });
  }

  return discountedLots;
}

async function findActiveProductByEan13(
  executor: QueryExecutor,
  schema: SchemaLike,
  ean13: string,
): Promise<ProductForWaste | null> {
  const [product] = await executor
    .select({
      productoId: schema.producto.productoId,
      nombre: schema.producto.productoNombre,
      exigeVencimiento: schema.categoria.categoriaExigeVencimiento,
    })
    .from(schema.producto)
    .innerJoin(
      schema.categoria,
      eq(schema.categoria.categoriaId, schema.producto.categoriaId),
    )
    .where(
      and(
        eq(schema.producto.productoEstado, 'activo'),
        eq(schema.producto.productoEan13, ean13),
      ),
    )
    .limit(1);

  return product
    ? {
        productoId: Number(product.productoId),
        nombre: product.nombre,
        exigeVencimiento: Boolean(product.exigeVencimiento),
      }
    : null;
}

async function findAvailableLotsForProduct(
  executor: QueryExecutor,
  schema: SchemaLike,
  productoId: number,
): Promise<AvailableLot[]> {
  const lots = await executor
    .select({
      loteId: schema.lote.loteId,
      cantidadActual: schema.lote.loteCantidadActual,
      fechaIngreso: schema.lote.loteFechaHoraIngreso,
      fechaVencimiento: schema.lotePerecible.lotePerecibleFechaVencimiento,
    })
    .from(schema.lote)
    .leftJoin(
      schema.lotePerecible,
      eq(schema.lotePerecible.loteId, schema.lote.loteId),
    )
    .where(
      and(
        eq(schema.lote.productoId, productoId),
        sql`${schema.lote.loteCantidadActual} > 0`,
      ),
    );

  return lots.map((lot) => ({
    loteId: lot.loteId,
    cantidadActual: Number(lot.cantidadActual),
    fechaIngreso: lot.fechaIngreso,
    fechaVencimiento: lot.fechaVencimiento ?? null,
  }));
}

function normalizeWasteError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: 'FORBIDDEN' as const,
        controllerId: 'waste' as const,
        message: error.message,
      },
    };
  }

  if (!(error instanceof WasteError)) {
    return null;
  }

  if (error.reason === 'product-not-found') {
    return {
      ok: false as const,
      error: {
        code: 'BUSINESS_RULE' as const,
        controllerId: 'waste' as const,
        fieldErrors: error.fieldErrors,
        message: 'El producto no existe o se encuentra inactivo.',
      },
    };
  }

  if (
    error.reason === 'stock-insufficient' ||
    error.reason === 'stock-changed'
  ) {
    return {
      ok: false as const,
      error: {
        code: 'BUSINESS_RULE' as const,
        controllerId: 'waste' as const,
        fieldErrors: error.fieldErrors,
        message:
          error.fieldErrors.cantidad ??
          'El stock disponible no alcanza para registrar la merma.',
      },
    };
  }

  return validationResponse(error.fieldErrors);
}

function validationResponse(fieldErrors: WasteFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: 'VALIDATION_ERROR' as const,
      controllerId: 'waste' as const,
      fieldErrors,
      message: 'Revise los campos marcados antes de continuar.',
    },
  };
}

export class WasteError extends Error {
  constructor(
    readonly reason:
      | 'product-not-found'
      | 'stock-insufficient'
      | 'stock-changed'
      | 'validation',
    readonly fieldErrors: WasteFieldErrors,
  ) {
    super('No fue posible registrar la merma.');
  }
}

type SchemaLike = typeof import('../../db/schema');
type QueryExecutor = {
  select: typeof import('../../db/client').db.select;
};
type MutationExecutor = QueryExecutor & {
  insert: typeof import('../../db/client').db.insert;
  update: typeof import('../../db/client').db.update;
};

export const wasteController = createWasteController();
