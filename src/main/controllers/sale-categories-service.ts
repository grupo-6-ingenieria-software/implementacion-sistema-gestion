import { sql, type SQL } from "drizzle-orm";
import {
  allocateRecordedSaleNetAmounts,
  isValidSaleHistoryDate,
  type SaleCategoryRequest,
  type SaleCategoryResult,
} from "../../shared/sales";
import type { Role } from "../../shared/navigation";
import { getChileDateRange } from "./dashboard-date";

export type SaleCategoryDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
};

export type SaleCategoryActor = {
  usuarioId: string;
  rol: Role;
};

export class SaleCategoryValidationError extends Error {}

type SaleCategoryRow = {
  ventaId: string;
  descuentoTipo: "ninguno" | "porcentaje" | "monto";
  descuentoValor: number | null;
  detalleVentaId: string;
  cantidad: number;
  precioUnitario: number;
  categoriaId: number;
  categoriaNombre: string;
};

export function validateSaleCategoryRequest(
  payload: unknown,
): SaleCategoryRequest {
  const input = payload as Partial<SaleCategoryRequest> | null;
  const fechaInicio =
    typeof input?.fechaInicio === "string" ? input.fechaInicio.trim() : "";
  const fechaTermino =
    typeof input?.fechaTermino === "string" ? input.fechaTermino.trim() : "";

  if (!isValidSaleHistoryDate(fechaInicio)) {
    throw new SaleCategoryValidationError("Ingrese una fecha de inicio válida.");
  }
  if (!isValidSaleHistoryDate(fechaTermino)) {
    throw new SaleCategoryValidationError("Ingrese una fecha de término válida.");
  }
  if (fechaInicio > fechaTermino) {
    throw new SaleCategoryValidationError(
      "La fecha de inicio no puede ser posterior a la fecha de término",
    );
  }
  return { fechaInicio, fechaTermino };
}

/** Consulta sin escrituras. La restricción por cajero se aplica antes de leer líneas. */
export async function loadSaleCategories(
  database: SaleCategoryDb,
  request: SaleCategoryRequest,
  actor: SaleCategoryActor,
): Promise<SaleCategoryResult> {
  const { fechaInicio, fechaTermino } = validateSaleCategoryRequest(request);
  if (!actor.usuarioId || (actor.rol !== "dueno" && actor.rol !== "trabajador")) {
    throw new Error("La consulta requiere una identidad autorizada.");
  }
  const { startUtc, endUtc } = getChileDateRange(fechaInicio, fechaTermino);
  const ownerFilter =
    actor.rol === "trabajador"
      ? sql`AND v.usuario_cajero_id = ${actor.usuarioId}`
      : sql``;
  const rows = await database.all<SaleCategoryRow>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_descuento_tipo AS descuentoTipo,
      v.venta_descuento_valor AS descuentoValor,
      dv.detalle_venta_id AS detalleVentaId,
      dv.detalle_venta_cantidad AS cantidad,
      hp.historial_precio_venta AS precioUnitario,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre
    FROM venta v
    JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    JOIN producto p ON p.producto_id = dv.producto_id
    JOIN categoria c ON c.categoria_id = p.categoria_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
      AND v.venta_estado = 'completada'
      AND NOT EXISTS (
        SELECT 1 FROM anulacion_venta av WHERE av.venta_id = v.venta_id
      )
      ${ownerFilter}
    ORDER BY v.venta_id, dv.detalle_venta_id
  `);

  const bySale = new Map<string, SaleCategoryRow[]>();
  for (const row of rows) {
    const group = bySale.get(row.ventaId) ?? [];
    group.push(row);
    bySale.set(row.ventaId, group);
  }

  const byCategory = new Map<number, SaleCategoryResult["categorias"][number]>();
  let totalUnits = 0;
  let totalNet = 0;
  for (const saleRows of bySale.values()) {
    const lines = saleRows.map((row) => {
      const quantity = Number(row.cantidad);
      const price = Number(row.precioUnitario);
      const subtotal = quantity * price;
      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        !Number.isSafeInteger(price) ||
        price < 0 ||
        !Number.isSafeInteger(subtotal) ||
        !Number.isSafeInteger(Number(row.categoriaId)) ||
        !row.categoriaNombre
      ) {
        throw new Error("El detalle de venta contiene datos incoherentes.");
      }
      return { id: row.detalleVentaId, subtotal };
    });
    const [sale] = saleRows;
    const netLines = allocateRecordedSaleNetAmounts(
      {
        discountType: sale.descuentoTipo,
        discountValue: Number(sale.descuentoValor ?? 0),
      },
      lines,
    );
    for (let index = 0; index < saleRows.length; index += 1) {
      const row = saleRows[index];
      const units = Number(row.cantidad);
      const net = netLines[index].montoNeto;
      const categoryId = Number(row.categoriaId);
      const category = byCategory.get(categoryId) ?? {
        categoriaId: categoryId,
        categoriaNombre: row.categoriaNombre,
        unidadesVendidas: 0,
        montoNeto: 0,
      };
      category.unidadesVendidas = safeAdd(category.unidadesVendidas, units);
      category.montoNeto = safeAdd(category.montoNeto, net);
      byCategory.set(categoryId, category);
      totalUnits = safeAdd(totalUnits, units);
      totalNet = safeAdd(totalNet, net);
    }
  }

  return {
    categorias: [...byCategory.values()].sort(
      (left, right) =>
        left.categoriaNombre.localeCompare(right.categoriaNombre, "es") ||
        left.categoriaId - right.categoriaId,
    ),
    totales: { unidadesVendidas: totalUnits, montoNeto: totalNet },
  };
}

function safeAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("El total de ventas excede el rango admitido.");
  }
  return sum;
}
