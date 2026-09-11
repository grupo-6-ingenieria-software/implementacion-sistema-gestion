import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  normalizeProductListPayload,
  type ActiveProductSearchItem,
  type ProductCategoryOption,
  type ProductDetailPayload,
  type ProductDetailResponse,
  type ProductListItem,
  type ProductListFilters,
  type ProductListResponse,
} from "../../shared/products";
import type { ControllerHandler, RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from "./auth-context";

export type ActiveProductQuery = {
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
  listProducts: (options: {
    filters: ProductListFilters;
    includeCost: boolean;
  }) => Promise<ProductListItem[]>;
  listCategories: () => Promise<ProductCategoryOption[]>;
  findProduct: (
    ean13: string,
    options: { includeCost: boolean },
  ) => Promise<ProductDetailResponse["product"] | null>;
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
    if (context.channel === "producto:listar") {
      const usuarioId = normalizeUsuarioIdPayload(payload);

      if (!usuarioId) {
        if (typeof payload !== "object" || payload === null) {
          return {
            ok: false,
            error: {
              code: "FORBIDDEN",
              controllerId: "product-query",
              message: "No hay un usuario autenticado para esta accion.",
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
          "dueno",
          "trabajador",
        ]);
        const products = await dependencies.listProducts({
          filters,
          includeCost: auth.role === "dueno",
        });
        const categories = await dependencies.listCategories();

        return {
          ok: true,
          data: {
            products,
            categories,
          },
        };
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          return {
            ok: false,
            error: {
              code: "FORBIDDEN",
              controllerId: "product-query",
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "DATABASE_ERROR",
            controllerId: "product-query",
            message: "No fue posible cargar los productos. Intente nuevamente.",
          },
        };
      }
    }

    if (
      context.channel === "producto:estado" ||
      context.channel === "producto:buscar"
    ) {
      const { ean13 } = normalizeProductDetailPayload(payload);

      if (!ean13) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: "product-query",
            message: "Debe indicar un producto valido.",
            fieldErrors: { ean13: "Debe indicar un EAN-13 valido." },
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
              code: "BUSINESS_RULE",
              controllerId: "product-query",
              message: "El producto no existe o se encuentra inactivo.",
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
          "dueno",
          "trabajador",
        ]);
        const product = await dependencies.findProduct(ean13, {
          includeCost: auth.role === "dueno",
        });

        if (!product) {
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              controllerId: "product-query",
              message: "No se encontro el producto solicitado.",
            },
          };
        }
        const categories = await dependencies.listCategories();

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
              code: "FORBIDDEN",
              controllerId: "product-query",
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "DATABASE_ERROR",
            controllerId: "product-query",
            message: "No fue posible cargar el producto. Intente nuevamente.",
          },
        };
      }
    }

    if (context.channel === "producto:buscar-activo") {
      const input = normalizeProductSearchPayload(payload);
      const query = input.ean13?.trim() || input.query?.trim();

      try {
        await dependencies.authorize(input.usuarioId, ["dueno", "trabajador"]);

        const products =
          (await dependencies.listActiveProducts?.({
            query,
            limit: normalizeLimit(input.limit),
          })) ?? [];

        if (query && products.length === 0) {
          return {
            ok: false,
            error: {
              code: "BUSINESS_RULE",
              controllerId: "product-query",
              message: "No se encontraron productos activos para la busqueda.",
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
              code: "FORBIDDEN",
              controllerId: "product-query",
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "DATABASE_ERROR",
            controllerId: "product-query",
            message:
              "No fue posible buscar productos activos. Intente nuevamente.",
          },
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "INVALID_CHANNEL",
        controllerId: "product-query",
        message: `Canal IPC no registrado: ${context.channel}`,
      },
    };
  };

  return {
    metadata: controllers[12],
    handle,
  };
}

export async function queryInventoryProducts(
  db: typeof import("../../db/client").db,
  schema: typeof import("../../db/schema"),
  options: { filters: ProductListFilters; includeCost: boolean },
): Promise<ProductListItem[]> {
  return db.transaction((tx) =>
    queryInventoryProductsWithExecutor(tx, schema, options),
  );
}

async function queryInventoryProductsWithExecutor(
  db: Pick<typeof import("../../db/client").db, "select">,
  schema: typeof import("../../db/schema"),
  options: {
    filters: ProductListFilters;
    includeCost: boolean;
  },
): Promise<ProductListItem[]> {
  const { filters, includeCost } = options;
  const conditions = [eq(schema.producto.productoEstado, "activo")];
  if (filters.categoriaId) {
    conditions.push(eq(schema.producto.categoriaId, filters.categoriaId));
  }
  if (filters.search) {
    conditions.push(
      /^\d{13}$/.test(filters.search)
        ? eq(schema.producto.productoEan13, filters.search)
        : like(schema.producto.productoNombre, `%${filters.search}%`),
    );
  }

  const productRows = await db
    .select({
      productoId: schema.producto.productoId,
      ean13: schema.producto.productoEan13,
      nombre: schema.producto.productoNombre,
      categoriaId: schema.producto.categoriaId,
      precioVenta: schema.producto.productoPrecioVenta,
      stockMinimo: schema.producto.productoStockMinimo,
      estado: schema.producto.productoEstado,
      fechaRegistro: schema.producto.productoFechaRegistro,
    })
    .from(schema.producto)
    .where(and(...conditions))
    .orderBy(
      filters.sortBy === "nombre" && filters.sortDirection === "desc"
        ? desc(schema.producto.productoNombre)
        : asc(schema.producto.productoNombre),
    );

  if (productRows.length === 0) return [];
  const productIds = productRows.map((row) => row.productoId);
  const categoryIds = [...new Set(productRows.map((row) => row.categoriaId))];

  const categoryRows = await db
    .select({
      id: schema.categoria.categoriaId,
      nombre: schema.categoria.categoriaNombre,
    })
    .from(schema.categoria)
    .where(inArray(schema.categoria.categoriaId, categoryIds))
    .orderBy(
      filters.sortBy === "categoria" && filters.sortDirection === "desc"
        ? desc(schema.categoria.categoriaNombre)
        : asc(schema.categoria.categoriaNombre),
    );

  const stockExpression = sql<number>`coalesce(sum(${schema.lote.loteCantidadActual}), 0)`;
  const stockRows = await db
    .select({
      productoId: schema.producto.productoId,
      stockActual: stockExpression,
    })
    .from(schema.producto)
    .leftJoin(
      schema.lote,
      eq(schema.lote.productoId, schema.producto.productoId),
    )
    .where(inArray(schema.producto.productoId, productIds))
    .groupBy(schema.producto.productoId)
    .orderBy(
      filters.sortBy === "stockActual" && filters.sortDirection === "desc"
        ? desc(stockExpression)
        : asc(stockExpression),
      asc(schema.producto.productoNombre),
    );

  const priceRows = includeCost
    ? await db
        .select({
          productoId: schema.historialPrecioProducto.productoId,
          precioCosto: schema.historialPrecioProducto.historialPrecioCosto,
        })
        .from(schema.historialPrecioProducto)
        .where(
          and(
            inArray(schema.historialPrecioProducto.productoId, productIds),
            isNull(
              schema.historialPrecioProducto.historialFechaHoraVigenciaHasta,
            ),
          ),
        )
        .orderBy(
          desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde),
        )
    : [];

  const categories = new Map(categoryRows.map((row) => [row.id, row.nombre]));
  const stocks = new Map(
    stockRows.map((row) => [row.productoId, Number(row.stockActual ?? 0)]),
  );
  const costs = new Map<number, number>();
  for (const row of priceRows) {
    if (!costs.has(row.productoId)) {
      costs.set(row.productoId, Number(row.precioCosto ?? 0));
    }
  }
  const categoryRank = new Map(
    categoryRows.map((row, index) => [row.id, index]),
  );
  const stockRank = new Map(
    stockRows.map((row, index) => [row.productoId, index]),
  );
  const orderedProducts = [...productRows];
  if (filters.sortBy === "categoria") {
    orderedProducts.sort(
      (left, right) =>
        (categoryRank.get(left.categoriaId) ?? Number.MAX_SAFE_INTEGER) -
        (categoryRank.get(right.categoriaId) ?? Number.MAX_SAFE_INTEGER),
    );
  } else if (filters.sortBy === "stockActual") {
    orderedProducts.sort(
      (left, right) =>
        (stockRank.get(left.productoId) ?? Number.MAX_SAFE_INTEGER) -
        (stockRank.get(right.productoId) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return orderedProducts.map((row) => {
    const item: ProductListItem = {
      ean13: row.ean13,
      nombre: row.nombre,
      categoria: categories.get(row.categoriaId) ?? "Sin categoria",
      categoriaId: row.categoriaId,
      precioVenta: Number(row.precioVenta),
      stockActual: stocks.get(row.productoId) ?? 0,
      stockMinimo: Number(row.stockMinimo),
      estado: row.estado,
      fechaRegistro: row.fechaRegistro,
    };
    if (includeCost) item.precioCosto = costs.get(row.productoId) ?? 0;
    return item;
  });
}
export async function queryProductDetailWithExecutor(
  db: Pick<typeof import("../../db/client").db, "select">,
  schema: typeof import("../../db/schema"),
  ean13: string,
  includeCost: boolean,
): Promise<ProductDetailResponse["product"] | null> {
  const [product] = await db
    .select({
      productoId: schema.producto.productoId,
      ean13: schema.producto.productoEan13,
      nombre: schema.producto.productoNombre,
      categoriaId: schema.producto.categoriaId,
      precioVenta: schema.producto.productoPrecioVenta,
      stockMinimo: schema.producto.productoStockMinimo,
      estado: schema.producto.productoEstado,
    })
    .from(schema.producto)
    .where(eq(schema.producto.productoEan13, ean13))
    .limit(1);
  if (!product) return null;
  if (!includeCost) {
    const { productoId: _productoId, ...visible } = product;
    return visible;
  }
  const [price] = await db
    .select({
      precioCosto: schema.historialPrecioProducto.historialPrecioCosto,
    })
    .from(schema.historialPrecioProducto)
    .where(
      and(
        eq(schema.historialPrecioProducto.productoId, product.productoId),
        isNull(schema.historialPrecioProducto.historialFechaHoraVigenciaHasta),
      ),
    )
    .orderBy(
      desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde),
    )
    .limit(1);
  const { productoId: _productoId, ...visible } = product;
  return { ...visible, precioCosto: Number(price?.precioCosto ?? 0) };
}

export async function queryProductCategoriesWithExecutor(
  db: Pick<typeof import("../../db/client").db, "select">,
  schema: typeof import("../../db/schema"),
): Promise<ProductCategoryOption[]> {
  return db
    .select({
      id: schema.categoria.categoriaId,
      nombre: schema.categoria.categoriaNombre,
    })
    .from(schema.categoria)
    .orderBy(asc(schema.categoria.categoriaNombre));
}

export async function queryActiveProductsWithExecutor(
  db: Pick<typeof import("../../db/client").db, "select">,
  schema: typeof import("../../db/schema"),
  options: { query?: string; ean13?: string; limit: number },
): Promise<ActiveProductListItem[]> {
  const search = options.ean13 ?? options.query;
  const conditions = [eq(schema.producto.productoEstado, "activo")];
  if (search) {
    conditions.push(
      or(
        eq(schema.producto.productoEan13, search),
        like(schema.producto.productoNombre, `%${search}%`),
      )!,
    );
  }
  const products = await db
    .select({
      productoId: schema.producto.productoId,
      ean13: schema.producto.productoEan13,
      nombre: schema.producto.productoNombre,
      categoriaId: schema.producto.categoriaId,
      precioVentaBase: schema.producto.productoPrecioVenta,
    })
    .from(schema.producto)
    .where(and(...conditions))
    .orderBy(asc(schema.producto.productoNombre))
    .limit(options.limit);
  if (products.length === 0) return [];
  const productIds = products.map((row) => row.productoId);
  const categoryIds = [...new Set(products.map((row) => row.categoriaId))];
  const categories = await db
    .select({
      id: schema.categoria.categoriaId,
      nombre: schema.categoria.categoriaNombre,
      exigeVencimiento: schema.categoria.categoriaExigeVencimiento,
    })
    .from(schema.categoria)
    .where(inArray(schema.categoria.categoriaId, categoryIds));
  const stocks = await db
    .select({
      productoId: schema.lote.productoId,
      stockDisponible: sql<number>`coalesce(sum(${schema.lote.loteCantidadActual}), 0)`,
    })
    .from(schema.lote)
    .where(inArray(schema.lote.productoId, productIds))
    .groupBy(schema.lote.productoId);
  const prices = await db
    .select({
      productoId: schema.historialPrecioProducto.productoId,
      precioVenta: schema.historialPrecioProducto.historialPrecioVenta,
    })
    .from(schema.historialPrecioProducto)
    .where(
      and(
        inArray(schema.historialPrecioProducto.productoId, productIds),
        isNull(schema.historialPrecioProducto.historialFechaHoraVigenciaHasta),
      ),
    )
    .orderBy(
      desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde),
    );
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const stockByProduct = new Map(
    stocks.map((row) => [row.productoId, Number(row.stockDisponible)]),
  );
  const priceByProduct = new Map<number, number>();
  for (const row of prices)
    if (!priceByProduct.has(row.productoId))
      priceByProduct.set(row.productoId, Number(row.precioVenta));
  return products.flatMap((product) => {
    const category = categoryById.get(product.categoriaId);
    if (!category) return [];
    return [
      {
        productoId: Number(product.productoId),
        ean13: product.ean13,
        nombre: product.nombre,
        categoria: category.nombre,
        exigeVencimiento: Boolean(category.exigeVencimiento),
        precioVenta:
          priceByProduct.get(product.productoId) ??
          Number(product.precioVentaBase),
        stockDisponible: stockByProduct.get(product.productoId) ?? 0,
      },
    ];
  });
}

const productQueryDependencies: ProductQueryDependencies = {
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import("../../db/client");

    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  listProducts: async ({ filters, includeCost }) => {
    const { db, schema } = await import("../../db/client");

    return queryInventoryProducts(db, schema, { filters, includeCost });
  },
  listCategories: async () => {
    const { db, schema } = await import("../../db/client");
    return queryProductCategoriesWithExecutor(db, schema);
  },
  findProduct: async (ean13, { includeCost }) => {
    const { db, schema } = await import("../../db/client");
    return queryProductDetailWithExecutor(db, schema, ean13, includeCost);
  },
  listActiveProducts: async (options) => {
    const { db, schema } = await import("../../db/client");
    return db.transaction((tx) =>
      queryActiveProductsWithExecutor(tx, schema, options),
    );
  },
};

export async function searchActiveProducts(
  query: ActiveProductQuery,
): Promise<ActiveProductListItem[]> {
  await productQueryDependencies.authorize(query.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  return (
    (await productQueryDependencies.listActiveProducts?.({
      ean13: query.ean13?.trim(),
      query: query.query?.trim(),
      limit: normalizeLimit(query.limit),
    })) ?? []
  );
}

export type ProductStateLookup = {
  productoId: number;
  estado: "activo" | "inactivo";
};

export type ActiveInventoryProductLookup = ProductStateLookup & {
  nombre: string;
  exigeVencimiento: boolean;
};

export async function queryProductStateByEan13(
  executor: ProductLookupExecutor,
  schema: ProductLookupSchema,
  ean13: string,
): Promise<ProductStateLookup | null> {
  const [product] = await executor
    .select({
      productoId: schema.producto.productoId,
      estado: schema.producto.productoEstado,
    })
    .from(schema.producto)
    .where(eq(schema.producto.productoEan13, ean13))
    .limit(1);

  return product
    ? { productoId: Number(product.productoId), estado: product.estado }
    : null;
}

export async function queryActiveProductByEan13(
  executor: ProductLookupExecutor,
  schema: ProductLookupSchema,
  ean13: string,
): Promise<ActiveInventoryProductLookup | null> {
  const [product] = await executor
    .select({
      productoId: schema.producto.productoId,
      estado: schema.producto.productoEstado,
      nombre: schema.producto.productoNombre,
      categoriaId: schema.producto.categoriaId,
    })
    .from(schema.producto)
    .where(
      and(
        eq(schema.producto.productoEstado, "activo"),
        eq(schema.producto.productoEan13, ean13),
      ),
    )
    .limit(1);
  if (!product) return null;
  const [category] = await executor
    .select({ exigeVencimiento: schema.categoria.categoriaExigeVencimiento })
    .from(schema.categoria)
    .where(eq(schema.categoria.categoriaId, product.categoriaId))
    .limit(1);
  if (!category) return null;
  return {
    productoId: Number(product.productoId),
    estado: product.estado,
    nombre: product.nombre,
    exigeVencimiento: Boolean(category.exigeVencimiento),
  };
}

type ProductLookupSchema = typeof import("../../db/schema");
type ProductLookupExecutor = Pick<
  typeof import("../../db/client").db,
  "select"
>;

export const productQueryController = createProductQueryController();

function normalizeProductDetailPayload(payload: unknown): ProductDetailPayload {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "ean13" in payload &&
    typeof payload.ean13 === "string"
  ) {
    return { ean13: payload.ean13.trim() };
  }

  return {};
}

function normalizeUsuarioIdPayload(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "usuarioId" in payload &&
    typeof payload.usuarioId === "string"
  ) {
    return payload.usuarioId.trim();
  }

  return undefined;
}

function normalizeProductSearchPayload(payload: unknown): ActiveProductQuery {
  if (typeof payload !== "object" || payload === null) {
    return {};
  }

  const record = payload as Record<string, unknown>;

  return {
    ean13: typeof record.ean13 === "string" ? record.ean13 : undefined,
    limit: typeof record.limit === "number" ? record.limit : undefined,
    query: typeof record.query === "string" ? record.query : undefined,
    usuarioId:
      typeof record.usuarioId === "string" ? record.usuarioId : undefined,
  };
}

function normalizeLimit(limit: unknown): number {
  return Math.min(Math.max(Number(limit ?? 20), 1), 50);
}
