import { and, eq, sql } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  normalizeStockAdjustmentPayload,
  validateStockAdjustmentPayload,
  hasStockAdjustmentFieldErrors,
  type StockAdjustmentAvailability,
  type StockAdjustmentResponse,
} from "../../shared/inventory-detail";
import type { ControllerHandler, RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
  type AuthenticatedUser,
} from "./auth-context";
import {
  queryActiveProductByEan13,
  type ActiveInventoryProductLookup,
} from "./product-query";
import { queryActiveLotsForProduct } from "./product-detail";

type StockAdjustmentDependencies = {
  authorize: (
    usuarioId: string | undefined,
    allowedRoles: readonly Role[],
  ) => Promise<AuthenticatedUser>;
  findActiveProduct: (
    ean13: string,
  ) => Promise<ActiveInventoryProductLookup | null>;
  executeAdjustment: (
    payload: {
      ean13: string;
      loteId: string;
      cantidad: number;
      justificacion: string;
      usuarioId: string;
    },
  ) => Promise<StockAdjustmentResponse>;
  queryAvailability: (
    ean13: string,
    includeCost: boolean,
  ) => Promise<StockAdjustmentAvailability | null>;
};

export function createStockAdjustmentController(
  dependencies: StockAdjustmentDependencies = stockAdjustmentDependencies,
): RegisteredController {
  const metadata = controllers.find((c) => c.id === "stock-adjustment")!;

  const handle: ControllerHandler<
    unknown,
    StockAdjustmentResponse | StockAdjustmentAvailability
  > = async (payload, context) => {
    if (context.channel === "ajuste:disponibilidad") {
      const ean13 = normalizeEan13(payload);
      if (!ean13) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: "stock-adjustment",
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
        const result = await dependencies.queryAvailability(
          ean13,
          auth.role === "dueno",
        );

        if (!result) {
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              controllerId: "stock-adjustment",
              message: "El producto no existe o se encuentra inactivo.",
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
              controllerId: "stock-adjustment",
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "DATABASE_ERROR",
            controllerId: "stock-adjustment",
            message:
              "No fue posible consultar la disponibilidad. Intente nuevamente.",
          },
        };
      }
    }

    if (context.channel === "ajuste:registrar") {
      const normalized = normalizeStockAdjustmentPayload(payload);
      const fieldErrors = validateStockAdjustmentPayload(normalized);

      if (hasStockAdjustmentFieldErrors(fieldErrors)) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: "stock-adjustment",
            message: "Revise los campos marcados antes de continuar.",
            fieldErrors,
          },
        };
      }

      try {
        const auth = await dependencies.authorize(normalized.usuarioId, [
          "dueno",
          "trabajador",
        ]);

        const result = await dependencies.executeAdjustment({
          ean13: normalized.ean13,
          loteId: normalized.loteId,
          cantidad: normalized.cantidad,
          justificacion: normalized.justificacion,
          usuarioId: auth.usuarioId,
        });

        return { ok: true, data: result };
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          return {
            ok: false,
            error: {
              code: "FORBIDDEN",
              controllerId: "stock-adjustment",
              message: error.message,
            },
          };
        }

        if (error instanceof StockAdjustmentError) {
          return {
            ok: false,
            error: {
              code: error.code,
              controllerId: "stock-adjustment",
              message: error.message,
              fieldErrors: error.fieldErrors,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "DATABASE_ERROR",
            controllerId: "stock-adjustment",
            message:
              "No fue posible registrar el ajuste. Intente nuevamente.",
          },
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "INVALID_CHANNEL",
        controllerId: "stock-adjustment",
        message: `Canal IPC no registrado: ${context.channel}`,
      },
    };
  };

  return { metadata, handle };
}

export class StockAdjustmentError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR" | "BUSINESS_RULE" | "NOT_FOUND",
    message: string,
    readonly fieldErrors?: Partial<Record<string, string>>,
  ) {
    super(message);
  }
}

async function executeAdjustment(payload: {
  ean13: string;
  loteId: string;
  cantidad: number;
  justificacion: string;
  usuarioId: string;
}): Promise<StockAdjustmentResponse> {
  const { db, schema } = await import("../../db/client");

  return db.transaction(async (tx) => {
    const product = await queryActiveProductByEan13(
      tx,
      schema,
      payload.ean13,
    );

    if (!product) {
      throw new StockAdjustmentError(
        "NOT_FOUND",
        "El producto no existe o se encuentra inactivo.",
        { ean13: "El producto no existe o se encuentra inactivo." },
      );
    }

    const [lot] = await tx
      .select({
        loteId: schema.lote.loteId,
        cantidadActual: schema.lote.loteCantidadActual,
        productoId: schema.lote.productoId,
      })
      .from(schema.lote)
      .where(eq(schema.lote.loteId, payload.loteId))
      .limit(1);

    if (!lot || lot.productoId !== product.productoId) {
      throw new StockAdjustmentError(
        "VALIDATION_ERROR",
        "El lote seleccionado no pertenece al producto.",
        { loteId: "El lote seleccionado no es valido para este producto." },
      );
    }

    const currentQty = Number(lot.cantidadActual);
    const newQty = currentQty + payload.cantidad;

    if (newQty < 0) {
      throw new StockAdjustmentError(
        "BUSINESS_RULE",
        `El ajuste dejaria el lote con cantidad negativa (actual: ${currentQty}, ajuste: ${payload.cantidad}).`,
        {
          cantidad: `La cantidad resultante no puede ser negativa. Stock actual del lote: ${currentQty}.`,
        },
      );
    }

    const result = await tx
      .update(schema.lote)
      .set({ loteCantidadActual: newQty })
      .where(
        and(
          eq(schema.lote.loteId, payload.loteId),
          sql`${schema.lote.loteCantidadActual} = ${currentQty}`,
        ),
      )
      .returning({ loteId: schema.lote.loteId });

    if (result.length === 0) {
      throw new StockAdjustmentError(
        "BUSINESS_RULE",
        "El stock del lote cambio durante la operacion. Intente nuevamente.",
      );
    }

    const [adjustment] = await tx
      .insert(schema.ajusteInventario)
      .values({
        ajusteCantidad: payload.cantidad,
        ajusteJustificacion: payload.justificacion,
        productoId: product.productoId,
        loteId: payload.loteId,
        usuarioId: payload.usuarioId,
      })
      .returning({
        ajusteInventarioId: schema.ajusteInventario.ajusteInventarioId,
      });

    await registerAuditLog(tx, schema, {
      tipoAccion: "registro",
      modulo: "inventario",
      descripcion: `Ajuste manual de stock para producto ${payload.ean13}, lote ${payload.loteId.slice(0, 8)}: ${payload.cantidad > 0 ? "+" : ""}${payload.cantidad}. Justificacion: ${payload.justificacion}`,
      usuarioId: payload.usuarioId,
    });

    return {
      ajusteInventarioId: adjustment.ajusteInventarioId,
      ean13: payload.ean13,
      loteId: payload.loteId,
      cantidadAjustada: payload.cantidad,
      nuevaCantidadLote: newQty,
    };
  });
}

async function queryAvailability(
  ean13: string,
  includeCost: boolean,
): Promise<StockAdjustmentAvailability | null> {
  const { db, schema } = await import("../../db/client");

  return db.transaction(async (tx) => {
    const product = await queryActiveProductByEan13(tx, schema, ean13);

    if (!product) return null;

    const lots = await queryActiveLotsForProduct(
      tx,
      schema,
      product.productoId,
      includeCost,
    );

    return {
      ean13,
      productoNombre: product.nombre,
      lots,
    };
  });
}

const stockAdjustmentDependencies: StockAdjustmentDependencies = {
  authorize: async (usuarioId, allowedRoles) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, allowedRoles);
  },
  findActiveProduct: async (ean13) => {
    const { db, schema } = await import("../../db/client");
    return db.transaction((tx) =>
      queryActiveProductByEan13(tx, schema, ean13),
    );
  },
  executeAdjustment,
  queryAvailability,
};

export const stockAdjustmentController = createStockAdjustmentController();

function normalizeEan13(payload: unknown): string | undefined {
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
