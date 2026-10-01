import { sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  MOVEMENT_TYPE_LABELS,
  normalizeMovementReportRequest,
  validateMovementReportRequest,
  type MovementReportCategoryOption,
  type MovementReportData,
  type MovementReportItem,
  type MovementReportRequest,
  type MovementReportSummary,
  type MovementReportType,
  type MovementReportTypeOption,
  type MovementReportUserOption,
  type MovementTypeSummary,
} from "../../shared/report-movements";
import { getChileDateRange } from "./dashboard-date";
import type { ControllerHandler, RegisteredController } from "./base";
import { AccessDeniedError } from "./auth-context";
import type { Role } from "../../shared/navigation";

export type MovementReportDependencies = {
  queryMovementReport: (
    request: MovementReportRequest,
  ) => Promise<MovementReportData>;
};

export const movementReportDependencies: MovementReportDependencies = {
  queryMovementReport: queryMovementReportFromDb,
};

type RawStockEvent = {
  id: string;
  fechaHora: string;
  tipo: MovementReportType;
  productoId: number;
  productoNombre: string;
  productoEan13: string;
  categoriaId: number;
  categoriaNombre: string;
  cantidad: number;
  saldo: number;
  loteId: string | null;
  descripcion: string;
  usuarioId: string;
  usuarioNombre: string;
};

export async function queryMovementReportFromDb(
  request: MovementReportRequest,
): Promise<MovementReportData> {
  const { db } = await import("../../db/client");
  const range = getChileDateRange(request.fechaInicio, request.fechaTermino);

  // 1. Obtener lista de categorías para el selector de filtros
  const categoriesRaw = await db.all<{ id: number; nombre: string }>(sql`
    SELECT
      categoria_id AS id,
      categoria_nombre AS nombre
    FROM categoria
    ORDER BY categoria_nombre ASC
  `);

  const categorias: MovementReportCategoryOption[] = categoriesRaw.map((c) => ({
    id: Number(c.id),
    nombre: String(c.nombre),
  }));

  // 2. Obtener lista de usuarios para el selector de filtros
  const usersRaw = await db.all<{ id: string; nombre: string }>(sql`
    SELECT DISTINCT
      u.usuario_id AS id,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id) AS nombre
    FROM usuario u
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    ORDER BY nombre ASC
  `);

  const usuarios: MovementReportUserOption[] = usersRaw.map((u) => ({
    id: String(u.id),
    nombre: String(u.nombre),
  }));

  // Opciones de tipo de movimiento
  const tipos: MovementReportTypeOption[] = [
    { id: "ingreso_lote", label: MOVEMENT_TYPE_LABELS.ingreso_lote },
    { id: "venta", label: MOVEMENT_TYPE_LABELS.venta },
    { id: "restitucion", label: MOVEMENT_TYPE_LABELS.restitucion },
    { id: "merma", label: MOVEMENT_TYPE_LABELS.merma },
    { id: "ajuste_manual", label: MOVEMENT_TYPE_LABELS.ajuste_manual },
  ];

  // 3. Reconstruir TODOS los eventos históricos para calcular el saldo corrido
  // 3.1 Ingresos de lote
  const ingresosLote = await db.all<RawStockEvent>(sql`
    SELECT
      l.lote_id AS id,
      l.lote_fecha_hora_ingreso AS fechaHora,
      'ingreso_lote' AS tipo,
      p.producto_id AS productoId,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre,
      l.lote_cantidad_inicial AS cantidad,
      0 AS saldo,
      l.lote_id AS loteId,
      'Ingreso de lote' AS descripcion,
      COALESCE(u.usuario_id, 'sistema') AS usuarioId,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id, 'Sistema') AS usuarioNombre
    FROM lote l
    INNER JOIN producto p ON p.producto_id = l.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN detalle_recepcion dr ON dr.lote_id = l.lote_id
    LEFT JOIN recepcion_pedido rp ON rp.recepcion_pedido_id = dr.recepcion_pedido_id
    LEFT JOIN ajuste_inventario ai ON ai.lote_id = l.lote_id AND ai.ajuste_justificacion LIKE 'Entrada de lote%'
    LEFT JOIN usuario u ON u.usuario_id = COALESCE(rp.usuario_id, ai.usuario_id)
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
  `);

  // 3.2 Salidas por venta
  const ventas = await db.all<RawStockEvent>(sql`
    SELECT
      vl.venta_lote_id AS id,
      v.venta_fecha_hora AS fechaHora,
      'venta' AS tipo,
      p.producto_id AS productoId,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre,
      -vl.venta_lote_cantidad_consumida AS cantidad,
      0 AS saldo,
      vl.lote_id AS loteId,
      'Venta ' || v.venta_id AS descripcion,
      COALESCE(u.usuario_id, 'sistema') AS usuarioId,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id, 'Sistema') AS usuarioNombre
    FROM venta_lote vl
    INNER JOIN venta v ON v.venta_id = vl.venta_id
    INNER JOIN lote l ON l.lote_id = vl.lote_id
    INNER JOIN producto p ON p.producto_id = l.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN usuario u ON u.usuario_id = v.usuario_cajero_id
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
  `);

  // 3.3 Restituciones por anulación de venta
  const restituciones = await db.all<RawStockEvent>(sql`
    SELECT
      (av.anulacion_venta_id || '_' || vl.venta_lote_id) AS id,
      av.anulacion_fecha_hora AS fechaHora,
      'restitucion' AS tipo,
      p.producto_id AS productoId,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre,
      vl.venta_lote_cantidad_consumida AS cantidad,
      0 AS saldo,
      vl.lote_id AS loteId,
      'Restitución por anulación de venta ' || av.venta_id AS descripcion,
      COALESCE(u.usuario_id, 'sistema') AS usuarioId,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id, 'Sistema') AS usuarioNombre
    FROM anulacion_venta av
    INNER JOIN venta_lote vl ON vl.venta_id = av.venta_id
    INNER JOIN lote l ON l.lote_id = vl.lote_id
    INNER JOIN producto p ON p.producto_id = l.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN usuario u ON u.usuario_id = av.usuario_id
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
  `);

  // 3.4 Salidas por merma
  const mermas = await db.all<RawStockEvent>(sql`
    SELECT
      ml.merma_lote_id AS id,
      m.merma_fecha_hora AS fechaHora,
      'merma' AS tipo,
      p.producto_id AS productoId,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre,
      -ml.merma_lote_cantidad_descontada AS cantidad,
      0 AS saldo,
      ml.lote_id AS loteId,
      'Merma por ' || m.merma_motivo AS descripcion,
      COALESCE(u.usuario_id, 'sistema') AS usuarioId,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id, 'Sistema') AS usuarioNombre
    FROM merma_lote ml
    INNER JOIN merma m ON m.merma_id = ml.merma_id
    INNER JOIN lote l ON l.lote_id = ml.lote_id
    INNER JOIN producto p ON p.producto_id = m.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN usuario u ON u.usuario_id = m.usuario_id
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
  `);

  // 3.5 Ajustes manuales
  const ajustes = await db.all<RawStockEvent>(sql`
    SELECT
      ai.ajuste_inventario_id AS id,
      ai.ajuste_fecha_hora AS fechaHora,
      'ajuste_manual' AS tipo,
      p.producto_id AS productoId,
      p.producto_nombre AS productoNombre,
      p.producto_ean_13 AS productoEan13,
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoriaNombre,
      ai.ajuste_cantidad AS cantidad,
      0 AS saldo,
      ai.lote_id AS loteId,
      ai.ajuste_justificacion AS descripcion,
      COALESCE(u.usuario_id, 'sistema') AS usuarioId,
      COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, u.usuario_id, 'Sistema') AS usuarioNombre
    FROM ajuste_inventario ai
    INNER JOIN producto p ON p.producto_id = ai.producto_id
    INNER JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN usuario u ON u.usuario_id = ai.usuario_id
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE ai.ajuste_justificacion NOT LIKE 'Entrada de lote%'
      AND ai.ajuste_justificacion NOT LIKE 'Merma por%'
  `);

  // Consolidar todos los eventos
  const allEvents: RawStockEvent[] = [
    ...ingresosLote,
    ...ventas,
    ...restituciones,
    ...mermas,
    ...ajustes,
  ];

  // 4. Agrupar por producto y calcular saldo acumulado en orden cronológico ascendente
  const eventsByProduct = new Map<number, RawStockEvent[]>();
  for (const evt of allEvents) {
    let list = eventsByProduct.get(evt.productoId);
    if (!list) {
      list = [];
      eventsByProduct.set(evt.productoId, list);
    }
    list.push(evt);
  }

  const enrichedEvents: RawStockEvent[] = [];
  for (const [_, list] of eventsByProduct) {
    list.sort((a, b) =>
      a.fechaHora.localeCompare(b.fechaHora) || a.id.localeCompare(b.id),
    );

    let runningBalance = 0;
    for (const evt of list) {
      runningBalance += Number(evt.cantidad) || 0;
      evt.saldo = runningBalance;
      enrichedEvents.push(evt);
    }
  }

  // 5. Aplicar filtros sobre los eventos que ya tienen su saldo resultante calculado
  const filtered = enrichedEvents.filter((evt) => {
    // Filtro de rango de fechas (UTC)
    if (evt.fechaHora < range.startUtc || evt.fechaHora >= range.endUtc) {
      return false;
    }
    // Filtro por tipo
    if (request.tipo && evt.tipo !== request.tipo) {
      return false;
    }
    // Filtro por categoría
    if (request.categoriaId && evt.categoriaId !== request.categoriaId) {
      return false;
    }
    // Filtro por usuario
    if (request.usuarioId && evt.usuarioId !== request.usuarioId) {
      return false;
    }
    return true;
  });

  // 6. Ordenar los movimientos filtrados de forma descendente (más recientes primero)
  filtered.sort((a, b) =>
    b.fechaHora.localeCompare(a.fechaHora) || b.id.localeCompare(a.id),
  );

  // 7. Calcular resumen por tipo de movimiento
  const typeCounters: Record<MovementReportType, { count: number; units: number }> = {
    ingreso_lote: { count: 0, units: 0 },
    venta: { count: 0, units: 0 },
    restitucion: { count: 0, units: 0 },
    merma: { count: 0, units: 0 },
    ajuste_manual: { count: 0, units: 0 },
  };

  let totalEntradas = 0;
  let totalSalidas = 0;

  const items: MovementReportItem[] = filtered.map((row) => {
    const qty = Number(row.cantidad) || 0;
    const absQty = Math.abs(qty);

    if (qty > 0) {
      totalEntradas += qty;
    } else if (qty < 0) {
      totalSalidas += absQty;
    }

    if (row.tipo in typeCounters) {
      typeCounters[row.tipo].count += 1;
      typeCounters[row.tipo].units += absQty;
    }

    return {
      id: row.id,
      fechaHora: row.fechaHora,
      tipo: row.tipo,
      tipoLabel: MOVEMENT_TYPE_LABELS[row.tipo] ?? row.tipo,
      productoId: Number(row.productoId),
      productoNombre: row.productoNombre,
      productoEan13: row.productoEan13,
      categoriaId: Number(row.categoriaId),
      categoriaNombre: row.categoriaNombre,
      cantidad: qty,
      saldo: Number(row.saldo) || 0,
      loteId: row.loteId ?? undefined,
      descripcion: row.descripcion,
      usuarioId: row.usuarioId,
      usuarioNombre: row.usuarioNombre,
    };
  });

  const resumenPorTipo: MovementTypeSummary[] = (
    Object.keys(typeCounters) as MovementReportType[]
  ).map((t) => ({
    tipo: t,
    tipoLabel: MOVEMENT_TYPE_LABELS[t],
    totalMovimientos: typeCounters[t].count,
    totalUnidades: typeCounters[t].units,
  }));

  const resumen: MovementReportSummary = {
    totalMovimientos: items.length,
    totalEntradas,
    totalSalidas,
    resumenPorTipo,
  };

  return {
    fechaInicio: request.fechaInicio,
    fechaTermino: request.fechaTermino,
    tipo: request.tipo ?? null,
    categoriaId: request.categoriaId ?? null,
    usuarioId: request.usuarioId ?? null,
    categorias,
    usuarios,
    tipos,
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

export function createMovementReportController(
  dependencies: MovementReportDependencies = movementReportDependencies,
): RegisteredController {
  const metadata = controllers.find(
    (controller) => controller.id === "movement-report",
  );
  if (!metadata) {
    throw new Error("Controller metadata not found for 'movement-report'");
  }

  const handle: ControllerHandler<unknown, MovementReportData> = async (
    payload,
    context,
  ) => {
    try {
      const role = effectiveSessionRole(context);
      if (role !== "dueno") {
        throw new AccessDeniedError("Operación restringida al rol Dueño.");
      }

      const request = normalizeMovementReportRequest(payload);
      const validation = validateMovementReportRequest(request);

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

      const data = await dependencies.queryMovementReport(request);

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

      console.error("[movement-report] Error al generar reporte:", error);
      return {
        ok: false,
        error: {
          code: "TECHNICAL_ERROR",
          controllerId: metadata.id,
          message:
            "No fue posible generar el reporte de movimientos de inventario.",
        },
      };
    }
  };

  return { metadata, handle };
}

export const movementReportController = createMovementReportController();
