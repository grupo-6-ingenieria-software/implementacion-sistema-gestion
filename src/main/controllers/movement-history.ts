import { sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  normalizeMovementHistoryFilters,
  type MovementHistoryItem,
  type MovementHistoryResponse,
  type MovementType,
} from "../../shared/inventory-detail";
import type { ControllerHandler, RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from "./auth-context";

type MovementHistoryDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  queryMovements: (
    filters: ReturnType<typeof normalizeMovementHistoryFilters>,
  ) => Promise<MovementHistoryResponse>;
};

export function createMovementHistoryController(
  dependencies: MovementHistoryDependencies = movementHistoryDependencies,
): RegisteredController {
  const metadata = controllers.find((c) => c.id === "movement-history")!;

  const handle: ControllerHandler<unknown, MovementHistoryResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel !== "movimiento:historial") {
      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "movement-history",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const filters = normalizeMovementHistoryFilters(payload);

    try {
      await dependencies.authorize(filters.usuarioId, [
        "dueno",
        "trabajador",
      ]);

      const result = await dependencies.queryMovements(filters);
      return { ok: true, data: result };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: "movement-history",
            message: error.message,
          },
        };
      }

      console.error("[movement-history] Error:", error);
      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "movement-history",
          message:
            "No fue posible cargar el historial de movimientos. Intente nuevamente.",
        },
      };
    }
  };

  return { metadata, handle };
}

async function queryMovements(
  filters: ReturnType<typeof normalizeMovementHistoryFilters>,
): Promise<MovementHistoryResponse> {
  const { db } = await import("../../db/client");

  const allMovements: MovementHistoryItem[] = [];

  // 1. Ingresos de lote
  if (!filters.tipo || filters.tipo === "ingreso_lote") {
    const conditions = buildConditions(filters, {
      ean13Column: "p.producto_ean_13",
      loteColumn: "l.lote_id",
      dateColumn: "l.lote_fecha_hora_ingreso",
    });

    const rows = await db.all<MovementRow>(sql`
      SELECT
        l.lote_id AS id,
        l.lote_fecha_hora_ingreso AS fecha,
        l.lote_cantidad_inicial AS cantidad,
        p.producto_ean_13 AS productoEan13,
        p.producto_nombre AS productoNombre,
        l.lote_id AS loteId,
        'Ingreso de lote' AS descripcion,
        COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, 'Sistema') AS usuario
      FROM lote l
      JOIN producto p ON p.producto_id = l.producto_id
      LEFT JOIN ajuste_inventario ai ON ai.lote_id = l.lote_id AND ai.ajuste_justificacion LIKE 'Entrada de lote%'
      LEFT JOIN usuario u ON u.usuario_id = ai.usuario_id
      LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
      WHERE 1=1 ${conditions}
      ORDER BY l.lote_fecha_hora_ingreso DESC
    `);

    for (const row of rows) {
      allMovements.push(mapRow(row, "ingreso_lote"));
    }
  }

  // 2. Mermas
  if (!filters.tipo || filters.tipo === "merma") {
    const conditions = buildConditions(filters, {
      ean13Column: "p.producto_ean_13",
      loteColumn: "ml.lote_id",
      dateColumn: "m.merma_fecha_hora",
    });

    const rows = await db.all<MovementRow>(sql`
      SELECT
        ml.merma_lote_id AS id,
        m.merma_fecha_hora AS fecha,
        -ml.merma_lote_cantidad_descontada AS cantidad,
        p.producto_ean_13 AS productoEan13,
        p.producto_nombre AS productoNombre,
        ml.lote_id AS loteId,
        'Merma por ' || m.merma_motivo AS descripcion,
        COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, 'Sistema') AS usuario
      FROM merma_lote ml
      JOIN merma m ON m.merma_id = ml.merma_id
      JOIN producto p ON p.producto_id = m.producto_id
      LEFT JOIN usuario u ON u.usuario_id = m.usuario_id
      LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
      WHERE 1=1 ${conditions}
      ORDER BY m.merma_fecha_hora DESC
    `);

    for (const row of rows) {
      allMovements.push(mapRow(row, "merma"));
    }
  }

  // 3. Ventas
  if (!filters.tipo || filters.tipo === "venta") {
    const conditions = buildConditions(filters, {
      ean13Column: "p.producto_ean_13",
      loteColumn: "vl.lote_id",
      dateColumn: "v.venta_fecha_hora",
    });

    const rows = await db.all<MovementRow>(sql`
      SELECT
        vl.venta_lote_id AS id,
        v.venta_fecha_hora AS fecha,
        -vl.venta_lote_cantidad_consumida AS cantidad,
        p.producto_ean_13 AS productoEan13,
        p.producto_nombre AS productoNombre,
        vl.lote_id AS loteId,
        'Venta ' || v.venta_id AS descripcion,
        COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, 'Sistema') AS usuario
      FROM venta_lote vl
      JOIN venta v ON v.venta_id = vl.venta_id
      JOIN lote l ON l.lote_id = vl.lote_id
      JOIN producto p ON p.producto_id = l.producto_id
      LEFT JOIN usuario u ON u.usuario_id = v.usuario_cajero_id
      LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
      WHERE v.venta_estado = 'completada' ${conditions}
      ORDER BY v.venta_fecha_hora DESC
    `);

    for (const row of rows) {
      allMovements.push(mapRow(row, "venta"));
    }
  }

  // 4. Ajustes manuales
  if (!filters.tipo || filters.tipo === "ajuste_manual") {
    const conditions = buildConditions(filters, {
      ean13Column: "p.producto_ean_13",
      loteColumn: "ai.lote_id",
      dateColumn: "ai.ajuste_fecha_hora",
    });

    const rows = await db.all<MovementRow>(sql`
      SELECT
        ai.ajuste_inventario_id AS id,
        ai.ajuste_fecha_hora AS fecha,
        ai.ajuste_cantidad AS cantidad,
        p.producto_ean_13 AS productoEan13,
        p.producto_nombre AS productoNombre,
        ai.lote_id AS loteId,
        ai.ajuste_justificacion AS descripcion,
        COALESCE(t.trabajador_nombre || ' ' || t.trabajador_apellido, 'Sistema') AS usuario
      FROM ajuste_inventario ai
      JOIN producto p ON p.producto_id = ai.producto_id
      LEFT JOIN usuario u ON u.usuario_id = ai.usuario_id
      LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
      WHERE ai.ajuste_justificacion NOT LIKE 'Entrada de lote%'
        AND ai.ajuste_justificacion NOT LIKE 'Merma por%'
        ${conditions}
      ORDER BY ai.ajuste_fecha_hora DESC
    `);

    for (const row of rows) {
      allMovements.push(mapRow(row, "ajuste_manual"));
    }
  }

  // Ordenar por fecha descendente
  allMovements.sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Paginar
  const total = allMovements.length;
  const start = (filters.page - 1) * filters.pageSize;
  const movements = allMovements.slice(start, start + filters.pageSize);

  return {
    movements,
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

function buildConditions(
  filters: { ean13?: string; loteId?: string; fechaDesde?: string; fechaHasta?: string },
  columns: { ean13Column: string; loteColumn: string; dateColumn: string },
): SQL {
  const parts: SQL[] = [];

  if (filters.ean13) {
    parts.push(sql`AND ${sql.raw(columns.ean13Column)} = ${filters.ean13}`);
  }
  if (filters.loteId) {
    parts.push(sql`AND ${sql.raw(columns.loteColumn)} = ${filters.loteId}`);
  }
  if (filters.fechaDesde) {
    parts.push(sql`AND ${sql.raw(columns.dateColumn)} >= ${filters.fechaDesde}`);
  }
  if (filters.fechaHasta) {
    parts.push(sql`AND ${sql.raw(columns.dateColumn)} < ${filters.fechaHasta + "T99"}`);
  }

  if (parts.length === 0) return sql``;
  return sql.join(parts, sql` `);
}

type MovementRow = {
  id: string;
  fecha: string;
  cantidad: number;
  productoEan13: string;
  productoNombre: string;
  loteId: string;
  descripcion: string;
  usuario: string;
};

function mapRow(row: MovementRow, tipo: MovementType): MovementHistoryItem {
  return {
    id: row.id,
    tipo,
    fecha: row.fecha,
    cantidad: Number(row.cantidad),
    productoEan13: row.productoEan13,
    productoNombre: row.productoNombre,
    loteId: row.loteId || undefined,
    descripcion: row.descripcion,
    usuario: row.usuario || "Sistema",
  };
}

const movementHistoryDependencies: MovementHistoryDependencies = {
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  queryMovements,
};

export const movementHistoryController = createMovementHistoryController();
