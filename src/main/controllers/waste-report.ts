import { sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  normalizeWasteReportRequest,
  validateWasteReportRequest,
  type WasteReportData,
  type WasteReportItem,
  type WasteReportRequest,
  type WasteReportSummary,
} from "../../shared/report-waste";
import type { WasteReason } from "../../shared/waste";
import { getChileDateRange } from "./dashboard-date";
import type { ControllerHandler, RegisteredController } from "./base";
import { AccessDeniedError } from "./auth-context";

export type WasteReportDependencies = {
  queryWasteReport: (request: WasteReportRequest) => Promise<WasteReportData>;
};

export const wasteReportDependencies: WasteReportDependencies = {
  queryWasteReport: queryWasteReportFromDb,
};

export async function queryWasteReportFromDb(
  request: WasteReportRequest,
): Promise<WasteReportData> {
  const { db } = await import("../../db/client");
  const range = getChileDateRange(request.fechaInicio, request.fechaTermino);

  type QueryRow = {
    id: string;
    fechaHora: string;
    productoNombre: string;
    productoEan13: string;
    categoriaNombre: string;
    cantidad: number;
    motivo: string;
    observacion: string | null;
    usuarioNombre: string;
    loteId: string;
    costoUnitario: number;
    costoTotal: number;
  };

  const rows = await db.all<QueryRow>(sql`
    SELECT
      ml.merma_lote_id AS id,
      m.merma_fecha_hora AS fechaHora,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_nombre AS categoriaNombre,
      ml.merma_lote_cantidad_descontada AS cantidad,
      m.merma_motivo AS motivo,
      m.merma_observacion AS observacion,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id) AS usuarioNombre,
      ml.lote_id AS loteId,
      l.lote_precio_costo AS costoUnitario,
      (ml.merma_lote_cantidad_descontada * l.lote_precio_costo) AS costoTotal
    FROM merma m
    INNER JOIN merma_lote ml ON ml.merma_id = m.merma_id
    INNER JOIN lote l ON l.lote_id = ml.lote_id
    INNER JOIN producto p ON p.producto_id = m.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    INNER JOIN usuario u ON u.usuario_id = m.usuario_id
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE datetime(m.merma_fecha_hora) >= datetime(${range.startUtc})
      AND datetime(m.merma_fecha_hora) < datetime(${range.endUtc})
    ORDER BY datetime(m.merma_fecha_hora) DESC, ml.merma_lote_id ASC
  `);

  const unidadesPorMotivo: Record<WasteReason, number> = {
    vencimiento: 0,
    dano: 0,
    robo: 0,
    error_registro: 0,
  };
  let totalUnidades = 0;
  let costoTotal = 0;

  const items: WasteReportItem[] = rows.map((row) => {
    const motivo = row.motivo as WasteReason;
    const cantidad = Number(row.cantidad) || 0;
    const costoUnit = Number(row.costoUnitario) || 0;
    const costoTot = Number(row.costoTotal) || cantidad * costoUnit;

    if (motivo in unidadesPorMotivo) {
      unidadesPorMotivo[motivo] += cantidad;
    }
    totalUnidades += cantidad;
    costoTotal += costoTot;

    return {
      id: row.id,
      fechaHora: row.fechaHora,
      productoNombre: row.productoNombre,
      productoEan13: row.productoEan13,
      categoriaNombre: row.categoriaNombre,
      cantidad,
      motivo,
      observacion: row.observacion ?? undefined,
      usuarioNombre: row.usuarioNombre,
      loteId: row.loteId,
      costoUnitario: costoUnit,
      costoTotal: costoTot,
    };
  });

  const resumen: WasteReportSummary = {
    unidadesPorMotivo,
    totalUnidades,
    costoTotal,
  };

  return {
    fechaInicio: request.fechaInicio,
    fechaTermino: request.fechaTermino,
    items,
    resumen,
  };
}

export function createWasteReportController(
  dependencies: WasteReportDependencies = wasteReportDependencies,
): RegisteredController {
  const metadata = controllers.find((c) => c.id === "waste-report")!;

  const handle: ControllerHandler<unknown, WasteReportData> = async (
    payload,
    context,
  ) => {
    if (context.channel !== "reporte:mermas") {
      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "waste-report",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    if (context.claims && context.claims.rol !== "dueno") {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          controllerId: "waste-report",
          message: "Operación restringida al rol Dueño.",
        },
      };
    }

    const request = normalizeWasteReportRequest(payload);
    const validation = validateWasteReportRequest(request);

    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          controllerId: "waste-report",
          message: validation.error,
        },
      };
    }

    try {
      const data = await dependencies.queryWasteReport(request);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: "waste-report",
            message: error.message,
          },
        };
      }

      console.error("[waste-report] Error querying waste report:", error);
      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "waste-report",
          message:
            "No fue posible generar el reporte de mermas. Intente nuevamente.",
        },
      };
    }
  };

  return { metadata, handle };
}

export const wasteReportController = createWasteReportController();
