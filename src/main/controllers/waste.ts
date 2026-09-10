import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { controllers } from "../../shared/controllers";
import {
  hasWasteFieldErrors,
  normalizeWasteRegisterPayload,
  type WasteDiscountedLot,
  type WasteFieldErrors,
  type WasteAvailabilityResponse,
  type WasteRegisterPayload,
  type WasteRegisterResponse,
  type WasteReason,
} from "../../shared/waste";
import type { ControllerHandler, RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from "./auth-context";
import { notifyDashboardUpdated } from "./dashboard-events";
import { queryActiveProductByEan13 } from "./product-query";
import { validateWasteInSql } from "./waste-sql-validation";

type WasteDependencies = {
  register: (payload: WasteRegisterPayload) => Promise<WasteRegisterResponse>;
  availability?: (
    payload: WasteRegisterPayload,
  ) => Promise<WasteAvailabilityResponse>;
};

type ProductForWaste = {
  productoId: number;
  exigeVencimiento: boolean;
  nombre: string;
};

type AvailableLot = {
  loteId: string;
  cantidadActual: number;
  fechaIngreso: string;
  fechaVencimiento: string | null;
};

export function createWasteController(
  dependencies: WasteDependencies = wasteDependencies,
): RegisteredController {
  const handle: ControllerHandler<
    unknown,
    WasteRegisterResponse | WasteAvailabilityResponse
  > = async (payload, context) => {
    if (
      context.channel !== "merma:registrar" &&
      context.channel !== "merma:disponibilidad"
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "waste",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const input = normalizeWasteRegisterPayload(payload);

    try {
      if (context.channel === "merma:disponibilidad") {
        if (!input.ean13 || !input.usuarioId) {
          return validationResponse({
            ean13: "Seleccione un producto activo para consultar su stock.",
          });
        }

        return {
          ok: true,
          data: await (dependencies.availability ?? getWasteAvailability)(
            input,
          ),
        };
      }

      return {
        ok: true,
        data: await dependencies.register(input),
      };
    } catch (error) {
      const knownError = normalizeWasteError(error);

      if (knownError) {
        return knownError;
      }

      return {
        ok: false,
        error: {
          code: "DATABASE_ERROR",
          controllerId: "waste",
          message: "No fue posible registrar la merma. Intente nuevamente.",
        },
      };
    }
  };

  return {
    metadata: controllers[14],
    handle,
  };
}

const wasteDependencies: WasteDependencies = {
  availability: getWasteAvailability,
  register: registerWaste,
};

async function getWasteAvailability(
  payload: WasteRegisterPayload,
): Promise<WasteAvailabilityResponse> {
  const { db, schema } = await import("../../db/client");
  return db.transaction(async (tx) => {
    const user = await authorizeUser(tx, schema, payload.usuarioId, [
      "dueno", "trabajador",
    ]);
    void user;
    const product = await queryActiveProductByEan13(tx, schema, payload.ean13);
    if (!product) {
      throw new WasteError("product-not-found", {
        ean13: "El producto no existe o se encuentra inactivo.",
      });
    }
    const lots = await findAvailableLotsForProduct(tx, schema, product.productoId);
    return {
      ean13: payload.ean13,
      stockDisponible: lots.reduce((total, lot) => total + lot.cantidadActual, 0),
      criterioSalida: product.exigeVencimiento ? "fefo" : "fecha_ingreso",
    };
  });
}

async function registerWaste(
  payload: WasteRegisterPayload,
): Promise<WasteRegisterResponse> {
  const { db, schema } = await import("../../db/client");
  let result: WasteRegisterResponse | undefined;

  await db.transaction(async (tx) => {
    result = await registerWasteWithExecutor(tx, schema, payload);
  });

  if (!result) {
    throw new Error("Waste registration did not return a result.");
  }

  notifyDashboardUpdated();

  return result;
}

export async function registerWasteWithExecutor(
  executor: MutationExecutor,
  schema: SchemaLike,
  payload: WasteRegisterPayload,
): Promise<WasteRegisterResponse> {
  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  const product = await queryActiveProductByEan13(
    executor,
    schema,
    payload.ean13,
  );

  if (!product) {
    throw new WasteError("product-not-found", {
      ean13: "El producto no existe o se encuentra inactivo.",
    });
  }

  const lots = await findAvailableLotsForProduct(
    executor,
    schema,
    product.productoId,
  );
  const stockDisponible = lots.reduce(
    (total, lot) => total + lot.cantidadActual,
    0,
  );
  const validation = await validateWasteInSql(
    executor,
    payload,
    stockDisponible,
  );
  const fieldErrors = validation.errors;

  if (hasWasteFieldErrors(fieldErrors)) {
    throw new WasteError(
      validation.stockInsufficient ? "stock-insufficient" : "validation",
      fieldErrors,
    );
  }

  const mermaId = randomUUID();
  const lotesDescontados = planWasteDiscounts(product, lots, payload.cantidad);
  const motivo = payload.motivo as WasteReason;

  await updateWasteLots(executor, schema, lotesDescontados);

  await executor.insert(schema.merma).values({
    mermaId,
    mermaMotivo: motivo,
    mermaObservacion: payload.observacion ?? null,
    productoId: product.productoId,
    usuarioId: user.usuarioId,
  });

  for (const lot of lotesDescontados) {
    await executor.insert(schema.mermaLote).values({
      mermaId,
      loteId: lot.loteId,
      mermaLoteCantidadDescontada: lot.cantidad,
    });

    await executor.insert(schema.ajusteInventario).values({
      ajusteCantidad: -lot.cantidad,
      ajusteJustificacion: `Merma por ${payload.motivo} para ${payload.ean13}`,
      productoId: product.productoId,
      loteId: lot.loteId,
      usuarioId: user.usuarioId,
    });
  }

  await registerAuditLog(executor, schema, {
    tipoAccion: "registro",
    modulo: "inventario",
    descripcion: `Merma registrada para producto ${payload.ean13} (${payload.cantidad} unidades).`,
    usuarioId: user.usuarioId,
  });

  return {
    mermaId,
    ean13: payload.ean13,
    cantidad: payload.cantidad,
    lotesDescontados,
  };
}

function planWasteDiscounts(
  product: ProductForWaste,
  lots: AvailableLot[],
  cantidad: number,
): WasteDiscountedLot[] {
  const orderedLots = [...lots].sort((left, right) => {
    if (product.exigeVencimiento) {
      const leftDate = left.fechaVencimiento ?? "9999-12-31";
      const rightDate = right.fechaVencimiento ?? "9999-12-31";

      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
    }

    return left.fechaIngreso.localeCompare(right.fechaIngreso);
  });

  const discountedLots: WasteDiscountedLot[] = [];
  let remaining = cantidad;

  for (const lot of orderedLots) {
    if (remaining === 0) {
      break;
    }

    const amount = Math.min(remaining, lot.cantidadActual);

    if (amount <= 0) {
      continue;
    }

    discountedLots.push({ loteId: lot.loteId, cantidad: amount });
    remaining -= amount;
  }

  if (remaining > 0) {
    throw new WasteError("stock-insufficient", {
      cantidad: "El stock disponible no alcanza para registrar la merma.",
    });
  }

  return discountedLots;
}

async function updateWasteLots(
  executor: MutationExecutor,
  schema: SchemaLike,
  discountedLots: WasteDiscountedLot[],
): Promise<void> {
  for (const lot of discountedLots) {
    const updatedLots = await executor
      .update(schema.lote)
      .set({
        loteCantidadActual: sql`${schema.lote.loteCantidadActual} - ${lot.cantidad}`,
      })
      .where(
        and(
          eq(schema.lote.loteId, lot.loteId),
          sql`${schema.lote.loteCantidadActual} >= ${lot.cantidad}`,
        ),
      )
      .returning({ loteId: schema.lote.loteId });

    if (updatedLots.length === 0) {
      throw new WasteError("stock-changed", {
        cantidad:
          "El stock cambio durante la operacion. Revise el producto e intente nuevamente.",
      });
    }
  }
}

async function findAvailableLotsForProduct(
  executor: QueryExecutor,
  schema: SchemaLike,
  productoId: number,
): Promise<AvailableLot[]> {
  const lots = await executor
    .select({
      loteId: schema.lote.loteId,
      cantidadActual: schema.lote.loteCantidadActual,
      fechaIngreso: schema.lote.loteFechaHoraIngreso,
    })
    .from(schema.lote)
    .where(
      and(
        eq(schema.lote.productoId, productoId),
        sql`${schema.lote.loteCantidadActual} > 0`,
      ),
    )
    .orderBy(asc(schema.lote.loteFechaHoraIngreso));

  if (lots.length === 0) return [];
  const expirations = await executor
    .select({
      loteId: schema.lotePerecible.loteId,
      fechaVencimiento: schema.lotePerecible.lotePerecibleFechaVencimiento,
    })
    .from(schema.lotePerecible)
    .where(inArray(schema.lotePerecible.loteId, lots.map((lot) => lot.loteId)))
    .orderBy(asc(schema.lotePerecible.lotePerecibleFechaVencimiento));
  const expirationByLot = new Map(
    expirations.map((row) => [row.loteId, row.fechaVencimiento]),
  );

  return lots.map((lot) => ({
    loteId: lot.loteId,
    cantidadActual: Number(lot.cantidadActual),
    fechaIngreso: lot.fechaIngreso,
    fechaVencimiento: expirationByLot.get(lot.loteId) ?? null,
  }));
}

function normalizeWasteError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "waste" as const,
        message: error.message,
      },
    };
  }

  if (!(error instanceof WasteError)) {
    return null;
  }

  if (error.reason === "product-not-found") {
    return {
      ok: false as const,
      error: {
        code: "BUSINESS_RULE" as const,
        controllerId: "waste" as const,
        fieldErrors: error.fieldErrors,
        message: "El producto no existe o se encuentra inactivo.",
      },
    };
  }

  if (
    error.reason === "stock-insufficient" ||
    error.reason === "stock-changed"
  ) {
    return {
      ok: false as const,
      error: {
        code: "BUSINESS_RULE" as const,
        controllerId: "waste" as const,
        fieldErrors: error.fieldErrors,
        message:
          error.fieldErrors.cantidad ??
          "El stock disponible no alcanza para registrar la merma.",
      },
    };
  }

  return validationResponse(error.fieldErrors);
}

function validationResponse(fieldErrors: WasteFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: "VALIDATION_ERROR" as const,
      controllerId: "waste" as const,
      fieldErrors,
      message: "Revise los campos marcados antes de continuar.",
    },
  };
}

export class WasteError extends Error {
  constructor(
    readonly reason:
      | "product-not-found"
      | "stock-insufficient"
      | "stock-changed"
      | "validation",
    readonly fieldErrors: WasteFieldErrors,
  ) {
    super("No fue posible registrar la merma.");
  }
}

type SchemaLike = typeof import("../../db/schema");
type QueryExecutor = {
  all: typeof import("../../db/client").db.all;
  select: typeof import("../../db/client").db.select;
};
type MutationExecutor = QueryExecutor & {
  insert: typeof import("../../db/client").db.insert;
  update: typeof import("../../db/client").db.update;
};

export const wasteController = createWasteController();
