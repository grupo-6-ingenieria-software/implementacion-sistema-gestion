import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { findControllerById } from "../../shared/controllers";
import {
  invalidWasteEanMessage,
  hasWasteFieldErrors,
  normalizeWasteRegisterPayload,
  type WasteDiscountedLot,
  type WasteFieldErrors,
  type WasteAvailabilityResponse,
  type WasteRegisterPayload,
  type WasteRegisterResponse,
  type WasteReason,
} from "../../shared/waste";
import type { ControllerHandler, RegisteredController } from "./BaseControladorAuxiliar";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from "./ContextoAutenticacionAuxiliar";
import { notifyDashboardUpdated } from "./EventosDashboardAuxiliar";
import { queryActiveProductByEan13 } from "./ConsultaProductoHandler";
import {
  integerExpression,
  numericSqlValue,
  validEanExpression,
  type SqlValidationExecutor,
} from "./PrimitivasValidacionSqlAuxiliar";

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

async function getWasteAvailability(
  payload: WasteRegisterPayload,
): Promise<WasteAvailabilityResponse> {
  const { db, schema } = await import("../../db/client");
  return db.transaction(async (tx) => {
    const user = await authorizeUser(tx, schema, payload.usuarioId, [
      "dueno",
      "trabajador",
    ]);
    void user;
    const product = await queryActiveProductByEan13(tx, schema, payload.ean13);
    if (!product) {
      throw new WasteError("product-not-found", {
        ean13: "El producto no existe o se encuentra inactivo.",
      });
    }
    const lots = await findAvailableLotsForProduct(
      tx,
      schema,
      product.productoId,
    );
    return {
      ean13: payload.ean13,
      stockDisponible: lots.reduce(
        (total, lot) => total + lot.cantidadActual,
        0,
      ),
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
    await updateWasteLots(executor, schema, [lot]);

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
    .where(
      inArray(
        schema.lotePerecible.loteId,
        lots.map((lot) => lot.loteId),
      ),
    )
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

export async function validateWasteInSql(
  executor: SqlValidationExecutor,
  values: WasteRegisterPayload,
  stockDisponible: number,
): Promise<{ errors: WasteFieldErrors; stockInsufficient: boolean }> {
  const quantity = numericSqlValue(values.cantidad);
  const observation = values.observacion ?? null;
  const userId = values.usuarioId ?? null;
  const [result] = await executor.all<{
    ean13Valid: number;
    quantityValid: number;
    stockValid: number;
    reasonValid: number;
    observationValid: number;
    userValid: number;
  }>(sql`SELECT
    ${validEanExpression(values.ean13)} AS ean13Valid,
    CASE WHEN ${integerExpression(quantity)} AND ${quantity} > 0 THEN 1 ELSE 0 END AS quantityValid,
    CASE WHEN ${integerExpression(quantity)} AND ${quantity} > 0 AND ${quantity} <= ${stockDisponible} THEN 1 ELSE 0 END AS stockValid,
    CASE WHEN ${values.motivo} IN ('vencimiento', 'dano', 'robo', 'error_registro') THEN 1 ELSE 0 END AS reasonValid,
    CASE WHEN ${observation} IS NULL OR (typeof(${observation}) = 'text' AND length(${observation}) <= 200) THEN 1 ELSE 0 END AS observationValid,
    CASE WHEN typeof(${userId}) = 'text' AND length(trim(${userId})) > 0 THEN 1 ELSE 0 END AS userValid`);
  const errors: WasteFieldErrors = {};
  if (!result.ean13Valid) errors.ean13 = invalidWasteEanMessage;
  if (!result.quantityValid)
    errors.cantidad = "La cantidad debe ser un entero mayor que 0.";
  else if (!result.stockValid)
    errors.cantidad = `La cantidad no puede superar el stock disponible (${stockDisponible}).`;
  if (!result.reasonValid)
    errors.motivo = "Seleccione un motivo de merma valido.";
  if (!result.observationValid)
    errors.observacion = "La observacion no puede superar 200 caracteres.";
  if (!result.userValid)
    errors.usuarioId = "No hay un usuario responsable para registrar la merma.";
  return {
    errors,
    stockInsufficient: Boolean(result.quantityValid && !result.stockValid),
  };
}


export function createMermaHandler(
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
    metadata: findControllerById("waste")!,
    handle,
  };
}

const wasteDependencies: WasteDependencies = {
  availability: getWasteAvailability,
  register: registerWaste,
};

export const mermaHandler = createMermaHandler();