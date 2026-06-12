import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import type { Role } from '../../shared/navigation';
import {
  filterAndSortProductList,
  normalizeProductListPayload,
  type ProductDetailPayload,
  type ProductDetailResponse,
  type ProductCategoryOption,
  type ProductListItem,
  type ProductListResponse,
} from '../../shared/products';
import type {
  ControllerHandler,
  RegisteredController,
} from './base';
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from './auth-context';

type ProductQueryDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  listProducts: (options: { includeCost: boolean }) => Promise<ProductListItem[]>;
  listCategories: () => Promise<ProductCategoryOption[]>;
  findProduct: (ean13: string) => Promise<ProductDetailResponse['product'] | null>;
};

export function createProductQueryController(
  dependencies: ProductQueryDependencies = productQueryDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, ProductListResponse | ProductDetailResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel === 'producto:listar') {
      try {
        const filters = normalizeProductListPayload(payload);
        const auth = await dependencies.authorize(
          normalizeUsuarioIdPayload(payload),
          ['dueno', 'trabajador'],
        );
        const [products, categories] = await Promise.all([
          dependencies.listProducts({ includeCost: auth.role === 'dueno' }),
          dependencies.listCategories(),
        ]);

        return {
          ok: true,
          data: {
            products: filterAndSortProductList(products, filters),
            categories,
          },
        };
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          return {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              controllerId: 'product-query',
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: 'DATABASE_ERROR',
            controllerId: 'product-query',
            message: 'No fue posible cargar los productos. Intente nuevamente.',
          },
        };
      }
    }

    if (context.channel === 'producto:estado') {
      try {
        await dependencies.authorize(normalizeUsuarioIdPayload(payload), [
          'dueno',
        ]);
        const { ean13 } = normalizeProductDetailPayload(payload);

        if (!ean13) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              controllerId: 'product-query',
              message: 'Debe indicar un producto valido.',
              fieldErrors: { ean13: 'Debe indicar un EAN-13 valido.' },
            },
          };
        }

        const [product, categories] = await Promise.all([
          dependencies.findProduct(ean13),
          dependencies.listCategories(),
        ]);

        if (!product) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              controllerId: 'product-query',
              message: 'No se encontro el producto solicitado.',
            },
          };
        }

        return {
          ok: true,
          data: {
            product,
            categories,
          },
        };
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          return {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              controllerId: 'product-query',
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: 'DATABASE_ERROR',
            controllerId: 'product-query',
            message: 'No fue posible cargar el producto. Intente nuevamente.',
          },
        };
      }
    }

    if (context.channel === 'producto:buscar-activo') {
      return {
        ok: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          controllerId: 'product-query',
          message: 'La busqueda operativa de producto activo aun no esta implementada.',
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'INVALID_CHANNEL',
        controllerId: 'product-query',
        message: `Canal IPC no registrado: ${context.channel}`,
      },
    };
  };

  return {
    metadata: controllers[12],
    handle,
  };
}

const productQueryDependencies: ProductQueryDependencies = {
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import('../../db/client');

    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  listProducts: async ({ includeCost }) => {
    const { db, schema } = await import('../../db/client');

    const rows = await db
      .select({
        ean13: schema.producto.productoEan13,
        nombre: schema.producto.productoNombre,
        categoria: schema.categoria.categoriaNombre,
        categoriaId: schema.categoria.categoriaId,
        precioCosto:
          schema.historialPrecioProducto.historialPrecioCosto,
        precioVenta: schema.producto.productoPrecioVenta,
        stockActual:
          sql<number>`coalesce(sum(${schema.lote.loteCantidadActual}), 0)`,
        stockMinimo: schema.producto.productoStockMinimo,
        estado: schema.producto.productoEstado,
        fechaRegistro: schema.producto.productoFechaRegistro,
      })
      .from(schema.producto)
      .innerJoin(
        schema.categoria,
        eq(schema.categoria.categoriaId, schema.producto.categoriaId),
      )
      .leftJoin(
        schema.lote,
        eq(schema.lote.productoId, schema.producto.productoId),
      )
      .leftJoin(
        schema.historialPrecioProducto,
        and(
          eq(
            schema.historialPrecioProducto.productoId,
            schema.producto.productoId,
          ),
          isNull(
            schema.historialPrecioProducto.historialFechaHoraVigenciaHasta,
          ),
        ),
      )
      .where(eq(schema.producto.productoEstado, 'activo'))
      .groupBy(
        schema.producto.productoId,
        schema.producto.productoEan13,
        schema.producto.productoNombre,
        schema.categoria.categoriaNombre,
        schema.categoria.categoriaId,
        schema.historialPrecioProducto.historialPrecioCosto,
        schema.producto.productoPrecioVenta,
        schema.producto.productoStockMinimo,
        schema.producto.productoEstado,
        schema.producto.productoFechaRegistro,
      );

    return rows.map((row) => {
      const { precioCosto, ...productRow } = row;
      const product: ProductListItem = {
        ...productRow,
        stockActual: Number(productRow.stockActual ?? 0),
      };

      if (includeCost) {
        product.precioCosto = Number(precioCosto ?? 0);
      }

      return product;
    });
  },
  listCategories: async () => {
    const { db, schema } = await import('../../db/client');

    return db
      .select({
        id: schema.categoria.categoriaId,
        nombre: schema.categoria.categoriaNombre,
      })
      .from(schema.categoria)
      .orderBy(asc(schema.categoria.categoriaNombre));
  },
  findProduct: async (ean13) => {
    const { db, schema } = await import('../../db/client');

    const [row] = await db
      .select({
        ean13: schema.producto.productoEan13,
        nombre: schema.producto.productoNombre,
        categoriaId: schema.producto.categoriaId,
        precioCosto: schema.historialPrecioProducto.historialPrecioCosto,
        precioVenta: schema.producto.productoPrecioVenta,
        stockMinimo: schema.producto.productoStockMinimo,
        estado: schema.producto.productoEstado,
      })
      .from(schema.producto)
      .leftJoin(
        schema.historialPrecioProducto,
        and(
          eq(
            schema.historialPrecioProducto.productoId,
            schema.producto.productoId,
          ),
          isNull(
            schema.historialPrecioProducto.historialFechaHoraVigenciaHasta,
          ),
        ),
      )
      .where(eq(schema.producto.productoEan13, ean13))
      .orderBy(
        desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      ...row,
      precioCosto: Number(row.precioCosto ?? 0),
    };
  },
};

export const productQueryController = createProductQueryController();

function normalizeProductDetailPayload(payload: unknown): ProductDetailPayload {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'ean13' in payload &&
    typeof payload.ean13 === 'string'
  ) {
    return { ean13: payload.ean13.trim() };
  }

  return {};
}

function normalizeUsuarioIdPayload(payload: unknown): string | undefined {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'usuarioId' in payload &&
    typeof payload.usuarioId === 'string'
  ) {
    return payload.usuarioId.trim();
  }

  return undefined;
}
