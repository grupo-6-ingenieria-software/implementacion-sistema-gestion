import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { sql } from 'drizzle-orm';

type ProductSearchPayload = {
  query?: string;
  ean13?: string;
  limit?: number;
};

export type ActiveProductListItem = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  precioVenta: number;
  stockDisponible: number;
};

export const productQueryController: RegisteredController = {
  metadata: controllers[12],
  handle: async (payload, context) => {
    const input = (payload ?? {}) as ProductSearchPayload;
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);

    if (context.channel === 'producto:estado') {
      const ean13 = input.ean13?.trim();

      if (!ean13) {
        return controllerError(
          'VALIDATION_ERROR',
          'Ingrese un EAN-13 para consultar el producto.',
          'product-query',
        );
      }

      const products = await findActiveProducts({ ean13, limit: 1 });
      const product = products[0];

      if (!product) {
        return controllerError(
          'BUSINESS_RULE',
          'El producto no existe o se encuentra inactivo.',
          'product-query',
        );
      }

      return controllerSuccess(product);
    }

    if (context.channel === 'producto:buscar-activo') {
      const query = input.ean13?.trim() || input.query?.trim();

      if (!query) {
        return controllerError(
          'VALIDATION_ERROR',
          'Ingrese un EAN-13 o nombre de producto para buscar.',
          'product-query',
        );
      }

      const products = await findActiveProducts({ query, limit });

      if (products.length === 0) {
        return controllerError(
          'BUSINESS_RULE',
          'No se encontraron productos activos para la búsqueda.',
          'product-query',
        );
      }

      return controllerSuccess(products);
    }

    const products = await findActiveProducts({
      query: input.query?.trim(),
      limit,
    });

    return controllerSuccess(products);
  },
};

async function findActiveProducts(input: {
  query?: string;
  ean13?: string;
  limit: number;
}): Promise<ActiveProductListItem[]> {
  const search = input.ean13 ?? input.query;

  const rows = search
    ? await db.all<ActiveProductListItem>(sql`
        SELECT
          p.producto_id AS productoId,
          p.producto_ean_13 AS ean13,
          p.producto_nombre AS nombre,
          c.categoria_nombre AS categoria,
          COALESCE(hp.historial_precio_venta, p.producto_precio_venta) AS precioVenta,
          (
            SELECT COALESCE(SUM(l.lote_cantidad_actual), 0)
            FROM lote l
            WHERE l.producto_id = p.producto_id
          ) AS stockDisponible
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
        WHERE p.producto_estado = 'activo'
          AND (
            p.producto_ean_13 = ${search}
            OR p.producto_ean_13 LIKE ${`%${search}%`}
            OR p.producto_nombre LIKE ${`%${search}%`}
          )
        ORDER BY p.producto_nombre ASC
        LIMIT ${input.limit}
      `)
    : await db.all<ActiveProductListItem>(sql`
        SELECT
          p.producto_id AS productoId,
          p.producto_ean_13 AS ean13,
          p.producto_nombre AS nombre,
          c.categoria_nombre AS categoria,
          COALESCE(hp.historial_precio_venta, p.producto_precio_venta) AS precioVenta,
          (
            SELECT COALESCE(SUM(l.lote_cantidad_actual), 0)
            FROM lote l
            WHERE l.producto_id = p.producto_id
          ) AS stockDisponible
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
        WHERE p.producto_estado = 'activo'
        ORDER BY p.producto_nombre ASC
        LIMIT ${input.limit}
      `);

  return rows.map((row) => ({
    productoId: Number(row.productoId),
    ean13: row.ean13,
    nombre: row.nombre,
    categoria: row.categoria,
    precioVenta: Number(row.precioVenta),
    stockDisponible: Number(row.stockDisponible),
  }));
}
