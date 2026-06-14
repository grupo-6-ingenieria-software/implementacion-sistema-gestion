import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import type { Role } from '../../shared/navigation';
import {
  filterAndSortProductList,
  normalizeProductListPayload,
  type ActiveProductSearchItem,
  type ProductCategoryOption,
  type ProductDetailPayload,
  type ProductDetailResponse,
  type ProductListItem,
  type ProductListResponse,
} from '../../shared/products';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from './auth-context';

type ProductSearchPayload = {
  query?: string;
  ean13?: string;
  limit?: number;
  usuarioId?: string;
};

export type ActiveProductListItem = ActiveProductSearchItem;

type ProductQueryResponse =
  | ProductListResponse
  | ProductDetailResponse
  | ActiveProductListItem
  | ActiveProductListItem[];

type ProductQueryDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  listProducts: (options: { includeCost: boolean }) => Promise<ProductListItem[]>;
  listCategories: () => Promise<ProductCategoryOption[]>;
  findProduct: (
    ean13: string,
    options: { includeCost: boolean },
  ) => Promise<ProductDetailResponse['product'] | null>;
  listActiveProducts?: (options: {
    query?: string;
    ean13?: string;
    limit: number;
  }) => Promise<ActiveProductListItem[]>;
};

export function createProductQueryController(
  dependencies: ProductQueryDependencies = productQueryDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, ProductQueryResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel === 'producto:listar') {
      const usuarioId = normalizeUsuarioIdPayload(payload);

      if (!usuarioId) {
        if (typeof payload !== 'object' || payload === null) {
          return {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              controllerId: 'product-query',
              message: 'No hay un usuario autenticado para esta accion.',
            },
          };
        }

        const input = normalizeProductSearchPayload(payload);
        const products = await dependencies.listActiveProducts?.({
          query: input.query?.trim(),
          limit: normalizeLimit(input.limit),
        });

        return {
          ok: true,
          data: products ?? [],
        };
      }

      try {
        const filters = normalizeProductListPayload(payload);
        const auth = await dependencies.authorize(usuarioId, [
          'dueno',
          'trabajador',
        ]);
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

      const usuarioId = normalizeUsuarioIdPayload(payload);

      if (!usuarioId) {
        const products = await dependencies.listActiveProducts?.({
          ean13,
          limit: 1,
        });
        const product = products?.[0];

        if (!product) {
          return {
            ok: false,
            error: {
              code: 'BUSINESS_RULE',
              controllerId: 'product-query',
              message: 'El producto no existe o se encuentra inactivo.',
            },
          };
        }

        return {
          ok: true,
          data: product,
        };
      }

      try {
        const auth = await dependencies.authorize(usuarioId, [
          'dueno',
          'trabajador',
        ]);
        const [product, categories] = await Promise.all([
          dependencies.findProduct(ean13, {
            includeCost: auth.role === 'dueno',
          }),
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
      const input = normalizeProductSearchPayload(payload);
      const query = input.ean13?.trim() || input.query?.trim();

      try {
        await dependencies.authorize(input.usuarioId, ['dueno', 'trabajador']);

        const products = (await dependencies.listActiveProducts?.({
          query,
          limit: normalizeLimit(input.limit),
        })) ?? [];

        if (query && products.length === 0) {
          return {
            ok: false,
            error: {
              code: 'BUSINESS_RULE',
              controllerId: 'product-query',
              message: 'No se encontraron productos activos para la busqueda.',
            },
          };
        }

        return {
          ok: true,
          data: products,
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
            message: 'No fue posible buscar productos activos. Intente nuevamente.',
          },
        };
      }
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
        precioCosto: schema.historialPrecioProducto.historialPrecioCosto,
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
  findProduct: async (ean13, { includeCost }) => {
    const { db, schema } = await import('../../db/client');

    const baseColumns = {
      ean13: schema.producto.productoEan13,
      nombre: schema.producto.productoNombre,
      categoriaId: schema.producto.categoriaId,
      precioVenta: schema.producto.productoPrecioVenta,
      stockMinimo: schema.producto.productoStockMinimo,
      estado: schema.producto.productoEstado,
    } as const;

    const priceJoin = and(
      eq(
        schema.historialPrecioProducto.productoId,
        schema.producto.productoId,
      ),
      isNull(schema.historialPrecioProducto.historialFechaHoraVigenciaHasta),
    );

    // Para `trabajador` (includeCost === false) el precio costo nunca se
    // selecciona, de modo que el costo no sale de la capa de datos.
    if (!includeCost) {
      const [row] = await db
        .select(baseColumns)
        .from(schema.producto)
        .leftJoin(schema.historialPrecioProducto, priceJoin)
        .where(eq(schema.producto.productoEan13, ean13))
        .orderBy(
          desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde),
        )
        .limit(1);

      return row ?? null;
    }

    const [row] = await db
      .select({
        ...baseColumns,
        precioCosto: schema.historialPrecioProducto.historialPrecioCosto,
      })
      .from(schema.producto)
      .leftJoin(schema.historialPrecioProducto, priceJoin)
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
  listActiveProducts: async ({ ean13, limit, query }) => {
    const { db, schema } = await import('../../db/client');
    const search = ean13 ?? query;
    const conditions = [eq(schema.producto.productoEstado, 'activo')];

    if (search) {
      conditions.push(
        or(
          eq(schema.producto.productoEan13, search),
          like(schema.producto.productoEan13, `%${search}%`),
          like(schema.producto.productoNombre, `%${search}%`),
        )!,
      );
    }

    const rows = await db
      .select({
        productoId: schema.producto.productoId,
        ean13: schema.producto.productoEan13,
        nombre: schema.producto.productoNombre,
        categoria: schema.categoria.categoriaNombre,
        exigeVencimiento: schema.categoria.categoriaExigeVencimiento,
        precioVenta:
          sql<number>`coalesce(${schema.historialPrecioProducto.historialPrecioVenta}, ${schema.producto.productoPrecioVenta})`,
        stockDisponible:
          sql<number>`coalesce(sum(${schema.lote.loteCantidadActual}), 0)`,
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
      .where(and(...conditions))
      .groupBy(
        schema.producto.productoId,
        schema.producto.productoEan13,
        schema.producto.productoNombre,
        schema.categoria.categoriaNombre,
        schema.categoria.categoriaExigeVencimiento,
        schema.historialPrecioProducto.historialPrecioVenta,
        schema.producto.productoPrecioVenta,
      )
      .orderBy(asc(schema.producto.productoNombre))
      .limit(limit);

    return rows.map((row) => ({
      productoId: Number(row.productoId),
      ean13: row.ean13,
      nombre: row.nombre,
      categoria: row.categoria,
      exigeVencimiento: Boolean(row.exigeVencimiento),
      precioVenta: Number(row.precioVenta),
      stockDisponible: Number(row.stockDisponible),
    }));
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

function normalizeProductSearchPayload(payload: unknown): ProductSearchPayload {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }

  const record = payload as Record<string, unknown>;

  return {
    ean13: typeof record.ean13 === 'string' ? record.ean13 : undefined,
    limit: typeof record.limit === 'number' ? record.limit : undefined,
    query: typeof record.query === 'string' ? record.query : undefined,
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId : undefined,
  };
}

function normalizeLimit(limit: unknown): number {
  return Math.min(Math.max(Number(limit ?? 20), 1), 50);
}
