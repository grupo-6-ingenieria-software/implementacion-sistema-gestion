import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import { controllerError, type RegisteredController } from "./base";

export type StockDiscountDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
  run: (query: SQL) => Promise<{ rowsAffected?: number }>;
};

export type StockDiscountItem = {
  productoId: number;
  cantidad: number;
  exigeVencimiento: boolean;
};

export type PlannedLotConsumption = {
  productoId: number;
  loteId: string;
  cantidad: number;
};

export class StockDiscountBusinessError extends Error {}

export async function planStockDiscount(
  database: Pick<StockDiscountDb, "all">,
  items: readonly StockDiscountItem[],
): Promise<PlannedLotConsumption[]> {
  const plan: PlannedLotConsumption[] = [];

  for (const item of items) {
    const availability = await database.all<{
      available: number;
      sufficient: number;
    }>(sql`
      SELECT
        COALESCE(SUM(lote_cantidad_actual), 0) AS available,
        CASE WHEN COALESCE(SUM(lote_cantidad_actual), 0) >= ${item.cantidad}
          THEN 1 ELSE 0 END AS sufficient
      FROM lote
      WHERE producto_id = ${item.productoId}
        AND lote_cantidad_actual > 0
    `);
    const available = Number(availability[0]?.available ?? 0);
    if (Number(availability[0]?.sufficient ?? 0) !== 1) {
      throw new StockDiscountBusinessError(
        `Stock insuficiente para confirmar la venta. Disponible: ${available}.`,
      );
    }
    const lots = await database.all<{
      loteId: string;
      cantidadActual: number;
      fechaIngreso: string;
    }>(sql`
      SELECT
        l.lote_id AS loteId,
        l.lote_cantidad_actual AS cantidadActual,
        l.lote_fecha_hora_ingreso AS fechaIngreso
      FROM lote l
      WHERE l.producto_id = ${item.productoId}
        AND l.lote_cantidad_actual > 0
    `);

    const expirationRows =
      item.exigeVencimiento && lots.length > 0
        ? await database.all<{ loteId: string; fechaVencimiento: string }>(sql`
            SELECT
              lote_id AS loteId,
              lote_perecible_fecha_vencimiento AS fechaVencimiento
            FROM lote_perecible
            WHERE lote_id IN (
              ${sql.join(
                lots.map((lot) => sql`${lot.loteId}`),
                sql`, `,
              )}
            )
          `)
        : [];
    const expirationByLot = new Map(
      expirationRows.map((row) => [row.loteId, row.fechaVencimiento]),
    );

    const orderedLots = [...lots].sort((left, right) => {
      if (item.exigeVencimiento) {
        const leftDate = expirationByLot.get(left.loteId) ?? "9999-12-31";
        const rightDate = expirationByLot.get(right.loteId) ?? "9999-12-31";
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      }
      return left.fechaIngreso.localeCompare(right.fechaIngreso);
    });

    let remaining = item.cantidad;
    for (const lot of orderedLots) {
      if (remaining === 0) break;
      const amount = Math.min(remaining, Number(lot.cantidadActual));
      if (amount <= 0) continue;
      plan.push({
        productoId: item.productoId,
        loteId: lot.loteId,
        cantidad: amount,
      });
      remaining -= amount;
    }

    if (remaining > 0) {
      throw new StockDiscountBusinessError(
        `Stock insuficiente para confirmar la venta. Disponible: ${available}.`,
      );
    }
  }

  return plan;
}

/** C17: aplica el plan con el orden contractual UPDATE lote -> INSERT venta_lote. */
export async function applyStockDiscount(
  database: Pick<StockDiscountDb, "run">,
  ventaId: string,
  plan: readonly PlannedLotConsumption[],
): Promise<void> {
  for (const lot of plan) {
    const result = await database.run(sql`
      UPDATE lote
      SET lote_cantidad_actual = lote_cantidad_actual - ${lot.cantidad}
      WHERE lote_id = ${lot.loteId}
        AND lote_cantidad_actual >= ${lot.cantidad}
    `);

    if (result.rowsAffected === 0) {
      throw new StockDiscountBusinessError(
        "El stock cambió durante la operación. Revise el carrito e intente nuevamente.",
      );
    }

    await database.run(sql`
      INSERT INTO venta_lote (
        venta_lote_id,
        venta_id,
        lote_id,
        venta_lote_cantidad_consumida
      )
      VALUES (${randomUUID()}, ${ventaId}, ${lot.loteId}, ${lot.cantidad})
    `);
  }
}

export const stockDiscountController: RegisteredController = {
  metadata: controllers[16],
  handle: async () =>
    controllerError(
      "BUSINESS_RULE",
      "El descuento de stock se ejecuta automáticamente al registrar una venta.",
      "stock-discount",
    ),
};
