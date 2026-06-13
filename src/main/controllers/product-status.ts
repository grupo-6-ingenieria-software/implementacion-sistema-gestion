import { eq } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import {
  hasProductStatusFieldErrors,
  normalizeProductStatusPayload,
  validateProductStatusPayload,
  type ProductStatusPayload,
  type ProductStatusResponse,
} from '../../shared/products';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';
import { notifyDashboardUpdated } from './dashboard-events';

type ProductStatusDependencies = {
  changeStatus: (payload: ProductStatusPayload) => Promise<ProductStatusResponse>;
};

export function createProductStatusController(
  dependencies: ProductStatusDependencies = productStatusDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, ProductStatusResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel !== 'producto:cambiar-estado') {
      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'product-status',
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const input = normalizeProductStatusPayload(payload);
    const fieldErrors = validateProductStatusPayload(input);

    if (hasProductStatusFieldErrors(fieldErrors)) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          controllerId: 'product-status',
          fieldErrors,
          message: 'Revise los campos marcados antes de continuar.',
        },
      };
    }

    try {
      return {
        ok: true,
        data: await dependencies.changeStatus(input),
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            controllerId: 'product-status',
            message: error.message,
          },
        };
      }

      if (error instanceof ProductStatusError) {
        return {
          ok: false,
          error: {
            code: error.reason === 'not-found' ? 'NOT_FOUND' : 'BUSINESS_RULE',
            controllerId: 'product-status',
            message: error.message,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: 'DATABASE_ERROR',
          controllerId: 'product-status',
          message: 'No fue posible cambiar el estado del producto.',
        },
      };
    }
  };

  return {
    metadata: controllers[11],
    handle,
  };
}

const productStatusDependencies: ProductStatusDependencies = {
  changeStatus,
};

async function changeStatus(
  payload: ProductStatusPayload,
): Promise<ProductStatusResponse> {
  const { db, schema } = await import('../../db/client');
  let response: ProductStatusResponse | undefined;

  await db.transaction(async (tx) => {
    const user = await authorizeUser(tx, schema, payload.usuarioId, [
      'dueno',
      'trabajador',
    ]);
    const product = await findProductByEan13(tx, schema, payload.ean13 ?? '');

    if (!product) {
      throw new ProductStatusError(
        'not-found',
        'No se encontro el producto solicitado.',
      );
    }

    if (product.estado === payload.estado) {
      throw new ProductStatusError(
        'same-status',
        `El producto ya se encuentra ${payload.estado}.`,
      );
    }

    await tx
      .update(schema.producto)
      .set({ productoEstado: payload.estado })
      .where(eq(schema.producto.productoId, product.id));

    await registerAuditLog(tx, schema, {
      tipoAccion: 'edicion',
      modulo: 'inventario',
      descripcion: `Producto ${payload.ean13} cambiado a estado ${payload.estado}`,
      usuarioId: user.usuarioId,
    });

    response = {
      ean13: payload.ean13 ?? '',
      estado: payload.estado!,
    };
  });

  notifyDashboardUpdated();

  return response!;
}

async function findProductByEan13(
  tx: TransactionLike,
  schema: SchemaLike,
  ean13: string,
): Promise<{ id: number; estado: 'activo' | 'inactivo' } | null> {
  const [product] = await tx
    .select({
      id: schema.producto.productoId,
      estado: schema.producto.productoEstado,
    })
    .from(schema.producto)
    .where(eq(schema.producto.productoEan13, ean13))
    .limit(1);

  return product ?? null;
}

export class ProductStatusError extends Error {
  constructor(
    readonly reason: 'not-found' | 'same-status',
    message: string,
  ) {
    super(message);
  }
}

type SchemaLike = typeof import('../../db/schema');
type TransactionLike = {
  select: typeof import('../../db/client').db.select;
  update: typeof import('../../db/client').db.update;
  insert: typeof import('../../db/client').db.insert;
};

export const productStatusController = createProductStatusController();
