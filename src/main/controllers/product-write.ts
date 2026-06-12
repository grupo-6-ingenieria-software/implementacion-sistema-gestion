import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { ControllerId } from '../../shared/navigation';
import {
  hasProductFieldErrors,
  normalizeProductEditPayload,
  normalizeProductFormPayload,
  validateProductFormValues,
  type ProductCreatePayload,
  type ProductEditPayload,
  type ProductFieldErrors,
  type ProductFormValues,
  type ProductMutationResponse,
} from '../../shared/products';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';

type ProductWriteDependencies<TPayload> = {
  save: (payload: TPayload) => Promise<ProductMutationResponse>;
};

type ProductWriteConfig<TPayload> = {
  controllerId: ControllerId;
  channel: string;
  metadata: RegisteredController['metadata'];
  normalize: (payload: unknown) => TPayload;
  validate: (payload: TPayload) => ProductFieldErrors;
  dependencies: ProductWriteDependencies<TPayload>;
};

export function createProductWriteController<TPayload>({
  channel,
  controllerId,
  dependencies,
  metadata,
  normalize,
  validate,
}: ProductWriteConfig<TPayload>): RegisteredController {
  const handle: ControllerHandler<unknown, ProductMutationResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel !== channel) {
      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId,
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const normalizedPayload = normalize(payload);
    const fieldErrors = validate(normalizedPayload);

    if (hasProductFieldErrors(fieldErrors)) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          controllerId,
          fieldErrors,
          message: 'Revise los campos marcados antes de continuar.',
        },
      };
    }

    try {
      return {
        ok: true,
        data: await dependencies.save(normalizedPayload),
      };
    } catch (error) {
      const knownError = normalizeProductWriteError(error, controllerId);

      if (knownError) {
        return knownError;
      }

      return {
        ok: false,
        error: {
          code: 'DATABASE_ERROR',
          controllerId,
          message: 'No fue posible guardar el producto. Intente nuevamente.',
        },
      };
    }
  };

  return {
    metadata,
    handle,
  };
}

export const productCreateDependencies: ProductWriteDependencies<ProductCreatePayload> =
  {
    save: createProduct,
  };

export const productEditDependencies: ProductWriteDependencies<ProductEditPayload> =
  {
    save: editProduct,
  };

export function normalizeCreatePayload(payload: unknown): ProductCreatePayload {
  return normalizeProductFormPayload(payload);
}

export function normalizeEditPayload(payload: unknown): ProductEditPayload {
  return normalizeProductEditPayload(payload);
}

export function validateCreatePayload(
  payload: ProductCreatePayload,
): ProductFieldErrors {
  return validateProductFormValues(payload);
}

export function validateEditPayload(
  payload: ProductEditPayload,
): ProductFieldErrors {
  const fieldErrors = {
    ...validateProductFormValues(payload),
  };

  if (!payload.originalEan13 || payload.ean13 !== payload.originalEan13) {
    fieldErrors.ean13 = 'El codigo EAN-13 no se puede modificar al editar.';
  }

  return fieldErrors;
}

async function createProduct(
  payload: ProductCreatePayload,
): Promise<ProductMutationResponse> {
  const { db, schema } = await import('../../db/client');

  await db.transaction(async (tx) => {
    const user = await authorizeUser(tx, schema, payload.usuarioId, ['dueno']);
    await ensureCategoryExists(tx, schema, payload.categoriaId);
    await ensureProductDoesNotExist(tx, schema, payload.ean13);

    const [createdProduct] = await tx
      .insert(schema.producto)
      .values({
        productoEan13: payload.ean13,
        productoNombre: payload.nombre,
        productoPrecioVenta: payload.precioVenta,
        productoStockMinimo: payload.stockMinimo,
        productoEstado: 'activo',
        categoriaId: payload.categoriaId,
      })
      .returning({ productoId: schema.producto.productoId });

    await tx.insert(schema.historialPrecioProducto).values({
      historialPrecioCosto: payload.precioCosto,
      historialPrecioVenta: payload.precioVenta,
      productoId: createdProduct.productoId,
    });

    await registerAuditLog(tx, schema, {
      tipoAccion: 'registro',
      modulo: 'inventario',
      descripcion: `Producto registrado: ${payload.ean13}`,
      usuarioId: user.usuarioId,
    });
  });

  return { ean13: payload.ean13 };
}

async function editProduct(
  payload: ProductEditPayload,
): Promise<ProductMutationResponse> {
  const { db, schema } = await import('../../db/client');

  await db.transaction(async (tx) => {
    const user = await authorizeUser(tx, schema, payload.usuarioId, ['dueno']);
    await ensureCategoryExists(tx, schema, payload.categoriaId);
    const product = await findProductByEan13(tx, schema, payload.originalEan13);

    if (!product) {
      throw new ProductWriteError('not-found', 'No se encontro el producto solicitado.');
    }

    const currentPrice = await findCurrentPrice(tx, schema, product.productoId);
    const priceChanged =
      !currentPrice ||
      currentPrice.historialPrecioCosto !== payload.precioCosto ||
      currentPrice.historialPrecioVenta !== payload.precioVenta;

    await tx
      .update(schema.producto)
      .set({
        productoNombre: payload.nombre,
        productoPrecioVenta: payload.precioVenta,
        productoStockMinimo: payload.stockMinimo,
        categoriaId: payload.categoriaId,
      })
      .where(eq(schema.producto.productoId, product.productoId));

    if (priceChanged) {
      await tx
        .update(schema.historialPrecioProducto)
        .set({ historialFechaHoraVigenciaHasta: sql`datetime('now')` })
        .where(
          and(
            eq(schema.historialPrecioProducto.productoId, product.productoId),
            isNull(
              schema.historialPrecioProducto.historialFechaHoraVigenciaHasta,
            ),
          ),
        );

      await tx.insert(schema.historialPrecioProducto).values({
        historialPrecioCosto: payload.precioCosto,
        historialPrecioVenta: payload.precioVenta,
        productoId: product.productoId,
      });
    }

    await registerAuditLog(tx, schema, {
      tipoAccion: 'edicion',
      modulo: 'inventario',
      descripcion: `Producto actualizado: ${payload.originalEan13}`,
      usuarioId: user.usuarioId,
    });
  });

  return { ean13: payload.originalEan13 };
}

async function ensureCategoryExists(
  tx: TransactionLike,
  schema: SchemaLike,
  categoriaId: number,
): Promise<void> {
  const [category] = await tx
    .select({ id: schema.categoria.categoriaId })
    .from(schema.categoria)
    .where(eq(schema.categoria.categoriaId, categoriaId))
    .limit(1);

  if (!category) {
    throw new ProductWriteError('category-not-found', 'Seleccione una categoria valida.');
  }
}

async function ensureProductDoesNotExist(
  tx: TransactionLike,
  schema: SchemaLike,
  ean13: string,
): Promise<void> {
  const product = await findProductByEan13(tx, schema, ean13);

  if (product) {
    throw new ProductWriteError('duplicate-ean', 'Ya existe un producto con ese EAN-13.');
  }
}

async function findProductByEan13(
  tx: TransactionLike,
  schema: SchemaLike,
  ean13: string,
) {
  const [product] = await tx
    .select({
      productoId: schema.producto.productoId,
      productoEan13: schema.producto.productoEan13,
    })
    .from(schema.producto)
    .where(eq(schema.producto.productoEan13, ean13))
    .limit(1);

  return product;
}

async function findCurrentPrice(
  tx: TransactionLike,
  schema: SchemaLike,
  productoId: number,
) {
  const [price] = await tx
    .select({
      historialPrecioCosto: schema.historialPrecioProducto.historialPrecioCosto,
      historialPrecioVenta: schema.historialPrecioProducto.historialPrecioVenta,
    })
    .from(schema.historialPrecioProducto)
    .where(
      and(
        eq(schema.historialPrecioProducto.productoId, productoId),
        isNull(schema.historialPrecioProducto.historialFechaHoraVigenciaHasta),
      ),
    )
    .orderBy(desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde))
    .limit(1);

  return price;
}

function normalizeProductWriteError(
  error: unknown,
  controllerId: ControllerId,
) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: 'FORBIDDEN' as const,
        controllerId,
        message: error.message,
      },
    };
  }

  if (!(error instanceof ProductWriteError)) {
    return null;
  }

  if (error.reason === 'duplicate-ean') {
    return {
      ok: false as const,
      error: {
        code: 'VALIDATION_ERROR' as const,
        controllerId,
        fieldErrors: { ean13: error.message },
        message: 'Revise los campos marcados antes de continuar.',
      },
    };
  }

  if (error.reason === 'category-not-found') {
    return {
      ok: false as const,
      error: {
        code: 'VALIDATION_ERROR' as const,
        controllerId,
        fieldErrors: { categoriaId: error.message },
        message: 'Revise los campos marcados antes de continuar.',
      },
    };
  }

  if (error.reason === 'not-found') {
    return {
      ok: false as const,
      error: {
        code: 'NOT_FOUND' as const,
        controllerId,
        message: error.message,
      },
    };
  }

  return {
    ok: false as const,
    error: {
      code: 'DATABASE_ERROR' as const,
      controllerId,
      message: 'No fue posible registrar la auditoria temporal.',
    },
  };
}

export class ProductWriteError extends Error {
  constructor(
    readonly reason:
      | 'category-not-found'
      | 'duplicate-ean'
      | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

type SchemaLike = typeof import('../../db/schema');
type TransactionLike = {
  select: typeof import('../../db/client').db.select;
  insert: typeof import('../../db/client').db.insert;
  update: typeof import('../../db/client').db.update;
};
