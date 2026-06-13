import { eq, sql } from 'drizzle-orm';
import { findControllerById, type ControllerMetadata } from '../../shared/controllers';
import {
  hasProductDeleteFieldErrors,
  normalizeProductDeletePayload,
  validateProductDeletePayload,
  type ProductDeletePayload,
  type ProductDeleteResponse,
} from '../../shared/products';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';
import { notifyDashboardUpdated } from './dashboard-events';

type ProductDeleteDependencies = {
  deleteProduct: (
    payload: ProductDeletePayload,
  ) => Promise<ProductDeleteResponse>;
};

const metadata = requireProductDeleteMetadata();

export function createProductDeleteController(
  dependencies: ProductDeleteDependencies = productDeleteDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, ProductDeleteResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel !== 'producto:eliminar') {
      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'product-delete',
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const input = normalizeProductDeletePayload(payload);
    const fieldErrors = validateProductDeletePayload(input);

    if (hasProductDeleteFieldErrors(fieldErrors)) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          controllerId: 'product-delete',
          fieldErrors,
          message: 'Revise los campos marcados antes de continuar.',
        },
      };
    }

    try {
      return {
        ok: true,
        data: await dependencies.deleteProduct(input),
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            controllerId: 'product-delete',
            message: error.message,
          },
        };
      }

      if (error instanceof ProductDeleteError) {
        return {
          ok: false,
          error: {
            code: error.reason === 'not-found' ? 'NOT_FOUND' : 'BUSINESS_RULE',
            controllerId: 'product-delete',
            message: error.message,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: 'DATABASE_ERROR',
          controllerId: 'product-delete',
          message: 'No fue posible eliminar el producto. Intente nuevamente.',
        },
      };
    }
  };

  return {
    metadata,
    handle,
  };
}

const productDeleteDependencies: ProductDeleteDependencies = {
  deleteProduct,
};

async function deleteProduct(
  payload: ProductDeletePayload,
): Promise<ProductDeleteResponse> {
  const { db, schema } = await import('../../db/client');
  let response: ProductDeleteResponse | undefined;

  await db.transaction(async (tx) => {
    const user = await authorizeUser(tx, schema, payload.usuarioId, [
      'dueno',
      'trabajador',
    ]);
    const product = await findProductByEan13(tx, schema, payload.ean13 ?? '');

    if (!product) {
      throw new ProductDeleteError(
        'not-found',
        'No se encontro el producto solicitado.',
      );
    }

    const blockers = await findProductRelationBlockers(
      tx,
      schema,
      product.productoId,
    );

    if (blockers.length > 0) {
      throw new ProductDeleteError(
        'has-relations',
        `El producto no puede eliminarse porque tiene registros asociados (${blockers.join(
          ', ',
        )}). Debe desactivarlo para impedir su uso en nuevas operaciones.`,
      );
    }

    await tx
      .delete(schema.historialPrecioProducto)
      .where(
        eq(schema.historialPrecioProducto.productoId, product.productoId),
      );
    await tx
      .delete(schema.producto)
      .where(eq(schema.producto.productoId, product.productoId));

    await registerAuditLog(tx, schema, {
      tipoAccion: 'eliminacion',
      modulo: 'inventario',
      descripcion: `Producto eliminado: ${payload.ean13} ${product.productoNombre}`,
      usuarioId: user.usuarioId,
    });

    response = {
      ean13: payload.ean13 ?? '',
    };
  });

  notifyDashboardUpdated();

  return response!;
}

async function findProductByEan13(
  tx: TransactionLike,
  schema: SchemaLike,
  ean13: string,
) {
  const [product] = await tx
    .select({
      productoId: schema.producto.productoId,
      productoNombre: schema.producto.productoNombre,
    })
    .from(schema.producto)
    .where(eq(schema.producto.productoEan13, ean13))
    .limit(1);

  return product ?? null;
}

async function findProductRelationBlockers(
  tx: TransactionLike,
  schema: SchemaLike,
  productoId: number,
): Promise<string[]> {
  const blockers: string[] = [];
  const relationCounts = [
    {
      label: 'lotes',
      count: await countByProduct(tx, schema.lote, schema.lote.productoId, productoId),
    },
    {
      label: 'mermas',
      count: await countByProduct(
        tx,
        schema.merma,
        schema.merma.productoId,
        productoId,
      ),
    },
    {
      label: 'ventas',
      count: await countByProduct(
        tx,
        schema.detalleVenta,
        schema.detalleVenta.productoId,
        productoId,
      ),
    },
    {
      label: 'movimientos de inventario',
      count: await countByProduct(
        tx,
        schema.ajusteInventario,
        schema.ajusteInventario.productoId,
        productoId,
      ),
    },
  ];

  for (const relation of relationCounts) {
    if (relation.count > 0) {
      blockers.push(relation.label);
    }
  }

  return blockers;
}

async function countByProduct(
  tx: TransactionLike,
  table: ProductRelationTable,
  column: ProductRelationColumn,
  productoId: number,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)` })
    .from(table)
    .where(eq(column, productoId));

  return Number(row?.total ?? 0);
}

export class ProductDeleteError extends Error {
  constructor(
    readonly reason: 'not-found' | 'has-relations',
    message: string,
  ) {
    super(message);
  }
}

type SchemaLike = typeof import('../../db/schema');
type TransactionLike = {
  select: typeof import('../../db/client').db.select;
  delete: typeof import('../../db/client').db.delete;
  insert: typeof import('../../db/client').db.insert;
};
type ProductRelationTable =
  | SchemaLike['lote']
  | SchemaLike['merma']
  | SchemaLike['detalleVenta']
  | SchemaLike['ajusteInventario'];
type ProductRelationColumn =
  | SchemaLike['lote']['productoId']
  | SchemaLike['merma']['productoId']
  | SchemaLike['detalleVenta']['productoId']
  | SchemaLike['ajusteInventario']['productoId'];

export const productDeleteController = createProductDeleteController();

function requireProductDeleteMetadata(): ControllerMetadata {
  const controllerMetadata = findControllerById('product-delete');

  if (!controllerMetadata) {
    throw new Error('No se encontro metadata para product-delete.');
  }

  return controllerMetadata;
}
