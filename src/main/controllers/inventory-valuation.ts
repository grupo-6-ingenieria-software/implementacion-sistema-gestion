import { sql, type SQL } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  normalizeInventoryValuationRequest,
  type InventoryValuationCategory,
  type InventoryValuationRequest,
  type InventoryValuationResult,
} from "../../shared/inventory-valuation";
import type { Role } from "../../shared/navigation";
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

export type AuthorizedInventoryValuation = {
  result: InventoryValuationResult;
  user: AuthenticatedUser;
};

export type InventoryValuationServiceDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
    sessionRole?: Role,
  ) => Promise<AuthenticatedUser>;
  query: () => Promise<InventoryValuationResult>;
};

export type InventoryValuationControllerDependencies = {
  load: (
    request: InventoryValuationRequest,
    sessionRole?: Role,
  ) => Promise<AuthorizedInventoryValuation>;
};

type InventoryValuationRow = {
  categoriaId: number;
  categoria: string;
  cantidadProductos: number;
  stockTotal: number;
  valorTotal: number;
};

export type InventoryValuationQueryExecutor = {
  all: <T>(query: SQL) => Promise<T[]>;
};

const spanishCategoryCollator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});

export async function queryInventoryValuationWithExecutor(
  executor: InventoryValuationQueryExecutor,
): Promise<InventoryValuationResult> {
  const rows = await executor.all<InventoryValuationRow>(sql`
    SELECT
      c.categoria_id AS categoriaId,
      c.categoria_nombre AS categoria,
      COUNT(DISTINCT p.producto_id) AS cantidadProductos,
      SUM(l.lote_cantidad_actual) AS stockTotal,
      SUM(l.lote_cantidad_actual * l.lote_precio_costo) AS valorTotal
    FROM lote l
    JOIN producto p ON p.producto_id = l.producto_id
    JOIN categoria c ON c.categoria_id = p.categoria_id
    WHERE l.lote_cantidad_actual > 0
    GROUP BY c.categoria_id, c.categoria_nombre
    ORDER BY c.categoria_nombre COLLATE NOCASE ASC, c.categoria_id ASC
  `);

  const categorias: InventoryValuationCategory[] = rows
    .map((row) => ({
      categoriaId: Number(row.categoriaId),
      categoria: row.categoria,
      cantidadProductos: Number(row.cantidadProductos),
      stockTotal: Number(row.stockTotal),
      valorTotal: Number(row.valorTotal),
    }))
    .sort(
      (left, right) =>
        spanishCategoryCollator.compare(left.categoria, right.categoria) ||
        left.categoriaId - right.categoriaId,
    );

  return {
    categorias,
    totalInventario: categorias.reduce(
      (total, categoria) => total + categoria.valorTotal,
      0,
    ),
  };
}

export async function loadAuthorizedInventoryValuation(
  request: InventoryValuationRequest,
  sessionRole?: Role,
  dependencies: InventoryValuationServiceDependencies = inventoryValuationServiceDependencies,
): Promise<AuthorizedInventoryValuation> {
  const user = await dependencies.authorize(
    request.usuarioId,
    ["dueno", "trabajador"],
    sessionRole,
  );
  const result = await dependencies.query();

  return { result, user };
}

export function createInventoryValuationController(
  dependencies: InventoryValuationControllerDependencies = inventoryValuationControllerDependencies,
): RegisteredController {
  const metadata = controllers.find(
    (controller) => controller.id === "inventory-valuation",
  )!;

  const handle: ControllerHandler<unknown, InventoryValuationResult> = async (
    payload,
    context,
  ) => {
    if (context.channel !== "inventario:valorizacion") {
      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "inventory-valuation",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    try {
      const request = normalizeInventoryValuationRequest(payload);
      const { result } = await dependencies.load(
        request,
        effectiveSessionRole(context),
      );
      return { ok: true, data: result };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return {
          ok: false,
          error: {
            code: "FORBIDDEN",
            controllerId: "inventory-valuation",
            message: error.message,
          },
        };
      }

      console.error("[inventory-valuation] Error:", error);
      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "inventory-valuation",
          message:
            "No fue posible calcular el valor del inventario. Intente nuevamente.",
        },
      };
    }
  };

  return { metadata, handle };
}

function effectiveSessionRole(context: ControllerContext): Role | undefined {
  return context.claims?.rol;
}

const inventoryValuationServiceDependencies: InventoryValuationServiceDependencies = {
  authorize: async (usuarioId, allowedRoles, sessionRole) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, allowedRoles, sessionRole);
  },
  query: async () => {
    const { db } = await import("../../db/client");
    return queryInventoryValuationWithExecutor(db);
  },
};

const inventoryValuationControllerDependencies: InventoryValuationControllerDependencies = {
  load: (request, sessionRole) =>
    loadAuthorizedInventoryValuation(request, sessionRole),
};

export const inventoryValuationController =
  createInventoryValuationController();
