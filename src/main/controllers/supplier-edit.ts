import { eq, inArray } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import { rutComparisonKey } from "../../shared/rut";
import {
  hasSupplierFieldErrors,
  normalizeSupplierEditPayload,
  validateSupplierEditPayload,
  type SupplierEditPayload,
  type SupplierEditResponse,
  type SupplierFieldErrors,
} from "../../shared/suppliers";
import type { RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from "./auth-context";

type SchemaLike = typeof import("../../db/schema");
type SupplierEditExecutor = Pick<
  typeof import("../../db/client").db,
  "delete" | "insert" | "select" | "update"
>;

type SupplierEditDependencies = {
  editSupplier: (payload: SupplierEditPayload) => Promise<SupplierEditResponse>;
};

export function createSupplierEditController(
  dependencies: SupplierEditDependencies = supplierEditDependencies,
): RegisteredController<unknown, SupplierEditResponse> {
  const metadata = controllers.find(
    (controller) => controller.id === "supplier-edit",
  );

  if (!metadata) {
    throw new Error("Falta declarar el controlador supplier-edit.");
  }

  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "proveedor:editar") {
        return {
          ok: false,
          error: {
            code: "INVALID_CHANNEL",
            controllerId: "supplier-edit",
            message: `Canal IPC no registrado: ${context.channel}`,
          },
        };
      }

      const input = normalizeSupplierEditPayload(payload);
      const fieldErrors = validateSupplierEditPayload(input);

      if (hasSupplierFieldErrors(fieldErrors)) {
        return validationResponse(fieldErrors);
      }

      try {
        return { ok: true, data: await dependencies.editSupplier(input) };
      } catch (error) {
        return normalizeSupplierEditError(error);
      }
    },
  };
}

const supplierEditDependencies: SupplierEditDependencies = {
  editSupplier: async (payload) => {
    const { db, schema } = await import("../../db/client");

    // La lectura de existencia/estado ocurre dentro de la misma transacción de
    // escritura (BEGIN IMMEDIATE en el driver instalado).
    return db.transaction((tx) => editSupplierWithExecutor(tx, schema, payload));
  },
};

export async function editSupplierWithExecutor(
  executor: SupplierEditExecutor,
  schema: SchemaLike,
  payload: SupplierEditPayload,
): Promise<SupplierEditResponse> {
  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  const input = normalizeSupplierEditPayload(payload);
  const fieldErrors = validateSupplierEditPayload(input);

  if (hasSupplierFieldErrors(fieldErrors)) {
    throw new SupplierEditError(
      "validation",
      "Revise los campos marcados antes de continuar.",
      fieldErrors,
    );
  }

  const suppliers = await executor
    .select({
      proveedorId: schema.proveedor.proveedorId,
      rut: schema.proveedor.proveedorRut,
      nombreRazonSocial: schema.proveedor.proveedorNombreRazonSocial,
      nombreContacto: schema.proveedor.proveedorNombreContacto,
      telefono: schema.proveedor.proveedorTelefono,
      correoElectronico: schema.proveedor.proveedorCorreoElectronico,
    })
    .from(schema.proveedor);
  const requestedKey = rutComparisonKey(input.rut);
  const current = suppliers.find(
    (supplier) => rutComparisonKey(supplier.rut) === requestedKey,
  );

  if (!current) {
    throw new SupplierNotFoundError();
  }

  const currentCategories = await executor
    .select({ id: schema.proveedorCategoria.categoriaId })
    .from(schema.proveedorCategoria)
    .where(eq(schema.proveedorCategoria.proveedorId, current.proveedorId));
  const existingCategories = await executor
    .select({ id: schema.categoria.categoriaId })
    .from(schema.categoria)
    .where(inArray(schema.categoria.categoriaId, input.categoriaIds));
  const existingCategoryIds = new Set(existingCategories.map(({ id }) => id));

  if (input.categoriaIds.some((id) => !existingCategoryIds.has(id))) {
    throw new SupplierEditError(
      "invalid-categories",
      "Una o más categorías seleccionadas no existen.",
      { categoriaIds: "Seleccione únicamente categorías disponibles." },
    );
  }

  const changedFields = getChangedSupplierFields(current, currentCategories, input);

  await executor
    .update(schema.proveedor)
    .set({
      proveedorNombreRazonSocial: input.nombreRazonSocial,
      proveedorNombreContacto: input.nombreContacto,
      proveedorTelefono: input.telefono,
      proveedorCorreoElectronico: input.correoElectronico,
    })
    .where(eq(schema.proveedor.proveedorId, current.proveedorId));

  await executor
    .delete(schema.proveedorCategoria)
    .where(eq(schema.proveedorCategoria.proveedorId, current.proveedorId));
  await executor.insert(schema.proveedorCategoria).values(
    input.categoriaIds.map((categoriaId) => ({
      proveedorId: current.proveedorId,
      categoriaId,
    })),
  );

  await registerAuditLog(executor, schema, {
    tipoAccion: "edicion_proveedor",
    modulo: "proveedores",
    descripcion:
      `Proveedor ${current.proveedorId} con RUT ${current.rut} editado por ` +
      `responsable ${user.usuarioId}. Campos modificados: ${
        changedFields.length > 0 ? changedFields.join(", ") : "sin cambios efectivos"
      }.`,
    usuarioId: user.usuarioId,
  });

  return { proveedorId: current.proveedorId, rut: current.rut };
}

function getChangedSupplierFields(
  current: {
    nombreRazonSocial: string;
    nombreContacto: string;
    telefono: string;
    correoElectronico: string;
  },
  currentCategories: { id: number }[],
  next: SupplierEditPayload,
): string[] {
  const changed: string[] = [];
  if (current.nombreRazonSocial !== next.nombreRazonSocial) changed.push("razón social");
  if (current.nombreContacto !== next.nombreContacto) changed.push("nombre de contacto");
  if (current.telefono !== next.telefono) changed.push("teléfono");
  if (current.correoElectronico !== next.correoElectronico) changed.push("correo electrónico");

  const previousIds = currentCategories.map(({ id }) => id).sort((a, b) => a - b);
  const nextIds = [...next.categoriaIds].sort((a, b) => a - b);
  if (
    previousIds.length !== nextIds.length ||
    previousIds.some((id, index) => id !== nextIds[index])
  ) {
    changed.push("categorías");
  }
  return changed;
}

function validationResponse(fieldErrors: SupplierFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: "VALIDATION_ERROR" as const,
      controllerId: "supplier-edit" as const,
      fieldErrors,
      message: "Revise los campos marcados antes de continuar.",
    },
  };
}

function normalizeSupplierEditError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "supplier-edit" as const,
        message: error.message,
      },
    };
  }
  if (error instanceof SupplierNotFoundError) {
    return {
      ok: false as const,
      error: {
        code: "NOT_FOUND" as const,
        controllerId: "supplier-edit" as const,
        message: error.message,
      },
    };
  }
  if (error instanceof SupplierEditError) {
    return validationResponse(error.fieldErrors);
  }
  return {
    ok: false as const,
    error: {
      code: "DATABASE_ERROR" as const,
      controllerId: "supplier-edit" as const,
      message: "No fue posible actualizar el proveedor. Intente nuevamente.",
    },
  };
}

export class SupplierNotFoundError extends Error {
  constructor() {
    super("No se encontró el proveedor solicitado.");
  }
}

export class SupplierEditError extends Error {
  constructor(
    readonly reason: "validation" | "invalid-categories",
    message: string,
    readonly fieldErrors: SupplierFieldErrors,
  ) {
    super(message);
  }
}

export const supplierEditController = createSupplierEditController();
