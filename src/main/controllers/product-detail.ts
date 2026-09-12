import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import type {
  ActiveLotItem,
  ProductDetailWithLotsResponse,
} from "../../shared/inventory-detail";
import type { ControllerHandler, RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from "./auth-context";

type ProductDetailDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  findProductWithLots: (
    ean13: string,
    includeCost: boolean,
  ) => Promise<ProductDetailWithLotsResponse | null>;
};

export function createProductDetailController(
  dependencies: ProductDetailDependencies = productDetailDependencies,
): RegisteredController {
  const metadata = controllers.find((c) => c.id === "product-detail")!;

  const handle: ControllerHandler<unknown, ProductDetailWithLotsResponse> =
    async (payload, context) => {
      if (context.channel !== "producto:detalle-lotes") {
        return {
          ok: false,
          error: {
            code: "INVALID_CHANNEL",
            controllerId: "product-detail",
            message: `Canal IPC no registrado: ${context.channel}`,
          },
        };
      }

      const ean13 = normalizeEan13Payload(payload);

      if (!ean13) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: "product-detail",
            message: "Debe indicar un producto valido.",
            fieldErrors: { ean13: "Debe indicar un EAN-13 valido." },
          },
        };
      }

      try {
        const auth = await dependencies.authorize(
          normalizeUsuarioId(payload),
          ["dueno", "trabajador"],
        );
        const result = await dependencies.findProductWithLots(
          ean13,
          auth.role === "dueno",
        );

        if (!result) {
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              controllerId: "product-detail",
              message: "No se encontro el producto solicitado.",
            },
          };
        }

        return { ok: true, data: result };
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          return {
            ok: false,
            error: {
              code: "FORBIDDEN",
              controllerId: "product-detail",
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "DATABASE_ERROR",
            controllerId: "product-detail",
            message:
              "No fue posible cargar el detalle del producto. Intente nuevamente.",
          },
        };
      }
    };

  return { metadata, handle };
}

export async function queryActiveLotsForProduct(
  executor: LotQueryExecutor,
  schema: LotQuerySchema,
  productoId: number,
  includeCost: boolean,
): Promise<ActiveLotItem[]> {
  const lots = await executor
    .select({
      loteId: schema.lote.loteId,
      cantidadActual: schema.lote.loteCantidadActual,
      precioCosto: schema.lote.lotePrecioCosto,
      fechaIngreso: schema.lote.loteFechaHoraIngreso,
      esPerecible: schema.lote.esLotePerecible,
    })
    .from(schema.lote)
    .where(
      and(
        eq(schema.lote.productoId, productoId),
        sql`${schema.lote.loteCantidadActual} > 0`,
      ),
    )
    .orderBy(asc(schema.lote.loteFechaHoraIngreso));

  if (lots.length === 0) return [];

  const lotIds = lots.map((l) => l.loteId);
  const expirations = await executor
    .select({
      loteId: schema.lotePerecible.loteId,
      fechaVencimiento:
        schema.lotePerecible.lotePerecibleFechaVencimiento,
    })
    .from(schema.lotePerecible)
    .where(
      sql`${schema.lotePerecible.loteId} IN (${sql.join(
        lotIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .orderBy(asc(schema.lotePerecible.lotePerecibleFechaVencimiento));

  const expirationByLot = new Map(
    expirations.map((row) => [row.loteId, row.fechaVencimiento]),
  );

  const result: ActiveLotItem[] = lots.map((lot) => {
    const item: ActiveLotItem = {
      loteId: lot.loteId,
      cantidadActual: Number(lot.cantidadActual),
      fechaIngreso: lot.fechaIngreso,
      esPerecible: Boolean(lot.esPerecible),
    };

    if (includeCost) {
      item.precioCosto = Number(lot.precioCosto);
    }

    const expiration = expirationByLot.get(lot.loteId);
    if (expiration) {
      item.fechaVencimiento = expiration;
    }

    return item;
  });

  // FEFO para perecibles, FIFO para no perecibles
  return result.sort((a, b) => {
    if (a.fechaVencimiento && b.fechaVencimiento) {
      const cmp = a.fechaVencimiento.localeCompare(b.fechaVencimiento);
      if (cmp !== 0) return cmp;
    }
    if (a.fechaVencimiento && !b.fechaVencimiento) return -1;
    if (!a.fechaVencimiento && b.fechaVencimiento) return 1;
    return a.fechaIngreso.localeCompare(b.fechaIngreso);
  });
}

async function findProductWithLots(
  ean13: string,
  includeCost: boolean,
): Promise<ProductDetailWithLotsResponse | null> {
  const { db, schema } = await import("../../db/client");

  return db.transaction(async (tx) => {
    const [product] = await tx
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

    const [category] = await tx
      .select({ nombre: schema.categoria.categoriaNombre })
      .from(schema.categoria)
      .where(eq(schema.categoria.categoriaId, product.categoriaId))
      .limit(1);

    let precioCosto: number | undefined;
    if (includeCost) {
      const detail = await queryProductPriceForDetail(tx, schema, product.productoId);
      precioCosto = detail;
    }

    const lots = await queryActiveLotsForProduct(
      tx,
      schema,
      product.productoId,
      includeCost,
    );

    const stockTotal = lots.reduce((sum, lot) => sum + lot.cantidadActual, 0);

    const productData: ProductDetailWithLotsResponse["product"] = {
      ean13: product.ean13,
      nombre: product.nombre,
      categoria: category?.nombre ?? "Sin categoria",
      categoriaId: product.categoriaId,
      precioVenta: Number(product.precioVenta),
      stockMinimo: Number(product.stockMinimo),
      estado: product.estado,
    };

    if (includeCost && precioCosto !== undefined) {
      productData.precioCosto = precioCosto;
    }

    return { product: productData, lots, stockTotal };
  });
}

const productDetailDependencies: ProductDetailDependencies = {
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  findProductWithLots,
};

export const productDetailController = createProductDetailController();

function normalizeEan13Payload(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "ean13" in payload &&
    typeof payload.ean13 === "string"
  ) {
    const trimmed = payload.ean13.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function normalizeUsuarioId(payload: unknown): string | undefined {
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

async function queryProductPriceForDetail(
  executor: LotQueryExecutor,
  schema: LotQuerySchema,
  productoId: number,
): Promise<number | undefined> {
  const [price] = await executor
    .select({
      precioCosto: schema.historialPrecioProducto.historialPrecioCosto,
    })
    .from(schema.historialPrecioProducto)
    .where(
      and(
        eq(schema.historialPrecioProducto.productoId, productoId),
        isNull(schema.historialPrecioProducto.historialFechaHoraVigenciaHasta),
      ),
    )
    .orderBy(
      desc(schema.historialPrecioProducto.historialFechaHoraVigenciaDesde),
    )
    .limit(1);

  return price ? Number(price.precioCosto) : undefined;
}

type LotQuerySchema = typeof import("../../db/schema");
type LotQueryExecutor = Pick<typeof import("../../db/client").db, "select">;
