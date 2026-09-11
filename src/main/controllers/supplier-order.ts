import { eq, inArray } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import {
  hasSupplierOrderFieldErrors,
  normalizeSupplierOrderCreatePayload,
  type SupplierOrderCreatePayload,
  type SupplierOrderCreateResponse,
  type SupplierOrderFieldErrors,
  validateSupplierOrderCreatePayload,
} from "../../shared/supplier-orders";
import type { RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from "./auth-context";

type SchemaLike = typeof import("../../db/schema");
type OrderExecutor = Pick<
  typeof import("../../db/client").db,
  "insert" | "select"
>;

type SupplierOrderControllerData = SupplierOrderCreateResponse;

type SupplierOrderDependencies = {
  registerOrder: (
    payload: SupplierOrderCreatePayload,
  ) => Promise<SupplierOrderCreateResponse>;
};

export function createSupplierOrderController(
  dependencies: SupplierOrderDependencies = supplierOrderDependencies,
): RegisteredController<unknown, SupplierOrderControllerData> {
  const metadata = controllers.find(
    (controller) => controller.id === "supplier-order",
  );

  if (!metadata) {
    throw new Error("Falta declarar el controlador supplier-order.");
  }

  return {
    metadata,
    handle: async (payload, context) => {
      try {
        if (context.channel === "pedido:registrar") {
          const input = normalizeSupplierOrderCreatePayload(payload);
          const fieldErrors = validateSupplierOrderCreatePayload(input);

          if (hasSupplierOrderFieldErrors(fieldErrors)) {
            return validationResponse(fieldErrors);
          }

          return { ok: true, data: await dependencies.registerOrder(input) };
        }

        return {
          ok: false,
          error: {
            code: "INVALID_CHANNEL",
            controllerId: "supplier-order",
            message: `Canal IPC no registrado: ${context.channel}`,
          },
        };
      } catch (error) {
        return normalizeSupplierOrderError(error);
      }
    },
  };
}

const supplierOrderDependencies: SupplierOrderDependencies = {
  registerOrder,
};

async function registerOrder(
  payload: SupplierOrderCreatePayload,
): Promise<SupplierOrderCreateResponse> {
  const { db, schema } = await import("../../db/client");

  return db.transaction((tx) =>
    registerSupplierOrderWithExecutor(tx, schema, payload),
  );
}

export async function registerSupplierOrderWithExecutor(
  executor: OrderExecutor,
  schema: SchemaLike,
  payload: SupplierOrderCreatePayload,
): Promise<SupplierOrderCreateResponse> {
  const fieldErrors = validateSupplierOrderCreatePayload(payload);

  if (hasSupplierOrderFieldErrors(fieldErrors)) {
    throw new SupplierOrderError(
      "validation",
      "Revise los campos marcados antes de continuar.",
      fieldErrors,
    );
  }

  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);

  const [provider] = await executor
    .select({ id: schema.proveedor.proveedorId })
    .from(schema.proveedor)
    .where(eq(schema.proveedor.proveedorId, payload.proveedorId))
    .limit(1);

  if (!provider) {
    throw new SupplierOrderError(
      "provider-not-found",
      "El proveedor seleccionado no existe.",
      { proveedorId: "Seleccione un proveedor existente." },
    );
  }

  const eanCodes = payload.lineas.map((line) => line.ean13);
  const products = await executor
    .select({
      id: schema.producto.productoId,
      ean13: schema.producto.productoEan13,
      estado: schema.producto.productoEstado,
    })
    .from(schema.producto)
    .where(inArray(schema.producto.productoEan13, eanCodes));
  const productByEan = new Map(products.map((product) => [product.ean13, product]));
  const productErrors: SupplierOrderFieldErrors = {};

  payload.lineas.forEach((line, index) => {
    const product = productByEan.get(line.ean13);
    if (!product || product.estado !== "activo") {
      productErrors[`lineas.${index}.ean13`] =
        "El producto no existe o se encuentra inactivo.";
    }
  });

  if (hasSupplierOrderFieldErrors(productErrors)) {
    throw new SupplierOrderError(
      "product-not-found",
      "Uno o más productos no existen o se encuentran inactivos.",
      productErrors,
    );
  }

  const [createdOrder] = await executor
    .insert(schema.pedidoProveedor)
    .values({
      pedidoProveedorEstado: "pendiente",
      proveedorId: provider.id,
      usuarioEmisorId: user.usuarioId,
    })
    .returning({ id: schema.pedidoProveedor.pedidoProveedorId });

  await executor.insert(schema.detallePedido).values(
    payload.lineas.map((line) => ({
      pedidoProveedorId: createdOrder.id,
      productoId: productByEan.get(line.ean13)!.id,
      cantidadSolicitada: line.cantidad,
      cantidadRecibida: 0,
    })),
  );

  await executor.insert(schema.historialAuditoriaPedido).values({
    historialApTipoEvento: "creacion",
    historialApNota: "Pedido registrado en estado Pendiente.",
    pedidoProveedorId: createdOrder.id,
    usuarioId: user.usuarioId,
  });

  await registerAuditLog(executor, schema, {
    descripcion: `Pedido a proveedor ${createdOrder.id} registrado con ${payload.lineas.length} producto(s).`,
    modulo: "proveedores",
    tipoAccion: "registro_pedido",
    usuarioId: user.usuarioId,
  });

  return { pedidoId: createdOrder.id, estado: "pendiente" };
}

function normalizeSupplierOrderError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "supplier-order" as const,
        message: error.message,
      },
    };
  }

  if (error instanceof SupplierOrderError) {
    return {
      ok: false as const,
      error: {
        code:
          error.reason === "validation" || error.reason === "provider-not-found"
            ? ("VALIDATION_ERROR" as const)
            : ("BUSINESS_RULE" as const),
        controllerId: "supplier-order" as const,
        fieldErrors: error.fieldErrors,
        message: error.message,
      },
    };
  }

  return {
    ok: false as const,
    error: {
      code: "DATABASE_ERROR" as const,
      controllerId: "supplier-order" as const,
      message: "No fue posible registrar el pedido. Intente nuevamente.",
    },
  };
}

function validationResponse(fieldErrors: SupplierOrderFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: "VALIDATION_ERROR" as const,
      controllerId: "supplier-order" as const,
      fieldErrors,
      message: "Revise los campos marcados antes de continuar.",
    },
  };
}

export class SupplierOrderError extends Error {
  constructor(
    readonly reason:
      | "validation"
      | "provider-not-found"
      | "product-not-found",
    message: string,
    readonly fieldErrors: SupplierOrderFieldErrors = {},
  ) {
    super(message);
  }
}

export const supplierOrderController = createSupplierOrderController();
