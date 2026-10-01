import { sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  DEFAULT_EXPIRING_LOTS_HORIZON,
  EXPIRING_LOTS_HORIZON_ERROR,
  normalizeExpiringLotsRequest,
  validateExpiringLotsRequest,
  type CategoryExpiringSummary,
  type ExpiringLotItem,
  type ExpiringLotsCategoryOption,
  type ExpiringLotsReportData,
  type ExpiringLotsReportRequest,
  type ExpiringLotsReportSummary,
} from "../../shared/report-expiring-lots";
import { getChileDateKey } from "../../shared/sales";
import { addCalendarDays, differenceInCalendarDays } from "./dashboard-date";
import type { ControllerHandler, RegisteredController } from "./base";
import { AccessDeniedError } from "./auth-context";
import type { Role } from "../../shared/navigation";

export type ExpiringLotsReportDependencies = {
  queryExpiringLotsReport: (
    request: ExpiringLotsReportRequest,
  ) => Promise<ExpiringLotsReportData>;
};

export const expiringLotsReportDependencies: ExpiringLotsReportDependencies = {
  queryExpiringLotsReport: queryExpiringLotsReportFromDb,
};

export async function queryExpiringLotsReportFromDb(
  request: ExpiringLotsReportRequest,
): Promise<ExpiringLotsReportData> {
  const { db } = await import("../../db/client");
  const horizon = request.horizonte ?? DEFAULT_EXPIRING_LOTS_HORIZON;
  const todayKey = getChileDateKey();
  const targetDateKey = addCalendarDays(todayKey, horizon);

  // Consulta de categorías disponibles para el selector
  const categoriesRaw = await db.all<{ id: number; nombre: string }>(sql`
    SELECT
      categoria_id AS id,
      categoria_nombre AS nombre
    FROM categoria
    ORDER BY categoria_nombre ASC
  `);

  const categorias: ExpiringLotsCategoryOption[] = categoriesRaw.map((c) => ({
    id: Number(c.id),
    nombre: String(c.nombre),
  }));

  type QueryRow = {
    loteId: string;
    productoId: number;
    productoNombre: string;
    productoEan13: string;
    categoriaId: number;
    categoriaNombre: string;
    proveedorId: number | null;
    proveedorNombre: string | null;
    cantidad: number;
    fechaVencimiento: string;
    precioCosto: number;
  };

  const rows = await db.all<QueryRow>(sql`
    SELECT
      l.lote_id AS loteId,
      p.producto_id AS productoId,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre,
      l.proveedor_id AS proveedorId,
      pr.proveedor_nombre_razon_social AS proveedorNombre,
      l.lote_cantidad_actual AS cantidad,
      lp.lote_perecible_fecha_vencimiento AS fechaVencimiento,
      l.lote_precio_costo AS precioCosto
    FROM lote l
    INNER JOIN lote_perecible lp ON lp.lote_id = l.lote_id
    INNER JOIN producto p ON p.producto_id = l.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN proveedor pr ON pr.proveedor_id = l.proveedor_id
    WHERE l.lote_cantidad_actual > 0
      AND date(lp.lote_perecible_fecha_vencimiento) >= date(${todayKey})
      AND date(lp.lote_perecible_fecha_vencimiento) <= date(${targetDateKey})
      ${request.categoriaId ? sql`AND p.categoria_id = ${request.categoriaId}` : sql``}
    ORDER BY date(lp.lote_perecible_fecha_vencimiento) ASC, p.producto_nombre ASC, l.lote_id ASC
  `);

  const categoryMap = new Map<
    number,
    {
      categoriaId: number;
      categoriaNombre: string;
      totalLotes: number;
      totalUnidades: number;
      costoEnRiesgo: number;
    }
  >();

  let totalLotes = 0;
  let totalUnidades = 0;
  let costoTotalEnRiesgo = 0;

  const items: ExpiringLotItem[] = rows.map((row) => {
    const cantidad = Number(row.cantidad) || 0;
    const precioCosto = Number(row.precioCosto) || 0;
    const costoEnRiesgo = cantidad * precioCosto;
    const cleanDate = (row.fechaVencimiento || "").slice(0, 10);
    const diasRestantes = Math.max(
      0,
      differenceInCalendarDays(cleanDate, todayKey),
    );

    totalLotes += 1;
    totalUnidades += cantidad;
    costoTotalEnRiesgo += costoEnRiesgo;

    const catId = Number(row.categoriaId);
    let catSummary = categoryMap.get(catId);
    if (!catSummary) {
      catSummary = {
        categoriaId: catId,
        categoriaNombre: row.categoriaNombre,
        totalLotes: 0,
        totalUnidades: 0,
        costoEnRiesgo: 0,
      };
      categoryMap.set(catId, catSummary);
    }
    catSummary.totalLotes += 1;
    catSummary.totalUnidades += cantidad;
    catSummary.costoEnRiesgo += costoEnRiesgo;

    return {
      loteId: row.loteId,
      productoId: Number(row.productoId),
      productoNombre: row.productoNombre,
      productoEan13: row.productoEan13,
      categoriaId: catId,
      categoriaNombre: row.categoriaNombre,
      proveedorId: row.proveedorId !== null ? Number(row.proveedorId) : null,
      proveedorNombre: row.proveedorNombre ?? null,
      cantidad,
      fechaVencimiento: cleanDate,
      diasRestantes,
      precioCosto,
      costoEnRiesgo,
    };
  });

  const porCategoria: CategoryExpiringSummary[] = Array.from(
    categoryMap.values(),
  ).sort((a, b) => b.costoEnRiesgo - a.costoEnRiesgo || a.categoriaNombre.localeCompare(b.categoriaNombre));

  const resumen: ExpiringLotsReportSummary = {
    totalLotes,
    totalUnidades,
    costoTotalEnRiesgo,
    porCategoria,
  };

  return {
    horizonte: horizon,
    categoriaId: request.categoriaId ?? null,
    fechaConsulta: todayKey,
    categorias,
    items,
    resumen,
  };
}

function effectiveSessionRole(context: {
  session?: { rol?: Role };
  claims?: { rol?: string; usuarioRol?: string };
}): Role | undefined {
  if (context.session?.rol) {
    return context.session.rol;
  }
  if (typeof context.claims?.rol === "string") {
    return context.claims.rol as Role;
  }
  if (typeof context.claims?.usuarioRol === "string") {
    return context.claims.usuarioRol as Role;
  }
  return undefined;
}

export function createExpiringLotsReportController(
  dependencies: ExpiringLotsReportDependencies = expiringLotsReportDependencies,
): RegisteredController {
  const metadata = controllers.find(
    (controller) => controller.id === "expiring-lots-report",
  );
  if (!metadata) {
    throw new Error(
      "Controller metadata not found for 'expiring-lots-report'",
    );
  }

  const handle: ControllerHandler<unknown, ExpiringLotsReportData> = async (
    payload,
    context,
  ) => {
    try {
      const role = effectiveSessionRole(context);
      if (role !== "dueno") {
        throw new AccessDeniedError("Operación restringida al rol Dueño.");
      }

      const request = normalizeExpiringLotsRequest(payload);
      const validation = validateExpiringLotsRequest(request);

      if (!validation.ok) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: metadata.id,
            message: validation.error,
          },
        };
      }

      const data = await dependencies.queryExpiringLotsReport(request);

      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: metadata.id,
            message: error.message,
          },
        };
      }

      console.error("[expiring-lots-report] Error al generar reporte:", error);
      return {
        ok: false,
        error: {
          code: "TECHNICAL_ERROR",
          controllerId: metadata.id,
          message: "No fue posible generar el reporte de lotes por vencer.",
        },
      };
    }
  };

  return { metadata, handle };
}

export const expiringLotsReportController =
  createExpiringLotsReportController();
