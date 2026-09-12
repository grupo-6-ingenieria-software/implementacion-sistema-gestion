import { sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  normalizeRestockListRequest,
  type RestockItem,
  type RestockListRequest,
} from "../../shared/restock";
import type {
  ControllerContext,
  ControllerHandler,
  RegisteredController,
} from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from "./auth-context";

export type AuthorizedRestockList = {
  items: RestockItem[];
  user: AuthenticatedUser;
};

export type RestockListServiceDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
    sessionRole?: Role,
  ) => Promise<AuthenticatedUser>;
  query: () => Promise<RestockItem[]>;
};

export type RestockListControllerDependencies = {
  load: (
    request: RestockListRequest,
    sessionRole?: Role,
  ) => Promise<AuthorizedRestockList>;
};

type RestockQueryRow = {
  nombre: string;
  ean13: string;
  categoria: string;
  stockActual: number;
  stockMinimo: number;
};

export type RestockQueryExecutor = {
  all: <T>(query: SQL) => Promise<T[]>;
};

const spanishNameCollator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});

export async function queryRestockListWithExecutor(
  executor: RestockQueryExecutor,
): Promise<RestockItem[]> {
  const rows = await executor.all<RestockQueryRow>(sql`
    SELECT
      p.producto_nombre AS nombre,
      p.producto_ean_13 AS ean13,
      c.categoria_nombre AS categoria,
      COALESCE(SUM(l.lote_cantidad_actual), 0) AS stockActual,
      p.producto_stock_minimo AS stockMinimo
    FROM producto p
    JOIN categoria c ON c.categoria_id = p.categoria_id
    LEFT JOIN lote l ON l.producto_id = p.producto_id
    GROUP BY
      p.producto_id,
      p.producto_nombre,
      p.producto_ean_13,
      c.categoria_nombre,
      p.producto_stock_minimo
    HAVING COALESCE(SUM(l.lote_cantidad_actual), 0) <= p.producto_stock_minimo
    ORDER BY
      stockActual ASC,
      p.producto_nombre COLLATE NOCASE ASC,
      p.producto_ean_13 ASC
  `);

  return rows
    .map((row) => {
      const stockActual = Number(row.stockActual);
      const stockMinimo = Number(row.stockMinimo);

      return {
        nombre: row.nombre,
        ean13: row.ean13,
        categoria: row.categoria,
        stockActual,
        stockMinimo,
        cantidadSugerida: Math.max(0, 2 * stockMinimo - stockActual),
      };
    })
    .sort(compareRestockItems);
}

export function compareRestockItems(a: RestockItem, b: RestockItem): number {
  return (
    a.stockActual - b.stockActual ||
    spanishNameCollator.compare(a.nombre, b.nombre) ||
    a.ean13.localeCompare(b.ean13)
  );
}

export async function loadAuthorizedRestockList(
  request: RestockListRequest,
  sessionRole?: Role,
  dependencies: RestockListServiceDependencies = restockListServiceDependencies,
): Promise<AuthorizedRestockList> {
  const user = await dependencies.authorize(
    request.usuarioId,
    ["dueno", "trabajador"],
    sessionRole,
  );
  const items = await dependencies.query();

  return { items, user };
}

export function createRestockListController(
  dependencies: RestockListControllerDependencies = restockListControllerDependencies,
): RegisteredController {
  const metadata = controllers.find((controller) => controller.id === "restock-list")!;

  const handle: ControllerHandler<unknown, RestockItem[]> = async (
    payload,
    context,
  ) => {
    if (context.channel !== "inventario:lista-reabastecimiento") {
      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "restock-list",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    try {
      const request = normalizeRestockListRequest(payload);
      const result = await dependencies.load(
        request,
        effectiveSessionRole(context),
      );
      return { ok: true, data: result.items };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: "restock-list",
            message: error.message,
          },
        };
      }

      console.error("[restock-list] Error:", error);
      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "restock-list",
          message:
            "No fue posible cargar la lista de reabastecimiento. Intente nuevamente.",
        },
      };
    }
  };

  return { metadata, handle };
}

function effectiveSessionRole(context: ControllerContext): Role | undefined {
  return context.claims?.rol;
}

const restockListServiceDependencies: RestockListServiceDependencies = {
  authorize: async (usuarioId, allowedRoles, sessionRole) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, allowedRoles, sessionRole);
  },
  query: async () => {
    const { db } = await import("../../db/client");
    return queryRestockListWithExecutor(db);
  },
};

const restockListControllerDependencies: RestockListControllerDependencies = {
  load: (request, sessionRole) =>
    loadAuthorizedRestockList(request, sessionRole),
};

export const restockListController = createRestockListController();
