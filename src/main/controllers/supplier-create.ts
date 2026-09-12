import { asc, inArray } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import { canonicalizeRut, rutComparisonKey } from "../../shared/rut";
import {
  hasSupplierFieldErrors,
  normalizeSupplierCategoryRequest,
  normalizeSupplierRegistrationPayload,
  validateSupplierRegistrationPayload,
  type SupplierCategoryOption,
  type SupplierFieldErrors,
  type SupplierRegistrationPayload,
  type SupplierRegistrationResponse,
} from "../../shared/suppliers";
import type { RegisteredController } from "./base";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from "./auth-context";

type SchemaLike = typeof import("../../db/schema");
type SupplierExecutor = Pick<
  typeof import("../../db/client").db,
  "insert" | "select"
>;

type SupplierControllerData =
  | SupplierCategoryOption[]
  | SupplierRegistrationResponse;

type SupplierCreateDependencies = {
  listCategories: (usuarioId?: string) => Promise<SupplierCategoryOption[]>;
  registerSupplier: (
    payload: SupplierRegistrationPayload,
  ) => Promise<SupplierRegistrationResponse>;
};

export function createSupplierCreateController(
  dependencies: SupplierCreateDependencies = supplierCreateDependencies,
): RegisteredController<unknown, SupplierControllerData> {
  const metadata = controllers.find(
    (controller) => controller.id === "supplier-create",
  );

  if (!metadata) {
    throw new Error("Falta declarar el controlador supplier-create.");
  }

  return {
    metadata,
    handle: async (payload, context) => {
      try {
        if (context.channel === "proveedor:categorias") {
          const input = normalizeSupplierCategoryRequest(payload);
          return {
            ok: true,
            data: await dependencies.listCategories(input.usuarioId),
          };
        }

        if (context.channel === "proveedor:registrar") {
          const input = normalizeSupplierRegistrationPayload(payload);
          const fieldErrors = validateSupplierRegistrationPayload(input);

          if (hasSupplierFieldErrors(fieldErrors)) {
            return validationResponse(fieldErrors);
          }

          return {
            ok: true,
            data: await dependencies.registerSupplier(input),
          };
        }

        return {
          ok: false,
          error: {
            code: "INVALID_CHANNEL",
            controllerId: "supplier-create",
            message: `Canal IPC no registrado: ${context.channel}`,
          },
        };
      } catch (error) {
        return normalizeSupplierCreateError(error, context.channel);
      }
    },
  };
}

const supplierCreateDependencies: SupplierCreateDependencies = {
  listCategories,
  registerSupplier,
};

async function listCategories(
  usuarioId?: string,
): Promise<SupplierCategoryOption[]> {
  const { db, schema } = await import("../../db/client");
  return db.transaction((tx) =>
    listSupplierCategoriesWithExecutor(tx, schema, usuarioId),
  );
}

async function registerSupplier(
  payload: SupplierRegistrationPayload,
): Promise<SupplierRegistrationResponse> {
  const { db, schema } = await import("../../db/client");
  return db.transaction((tx) =>
    registerSupplierWithExecutor(tx, schema, payload),
  );
}

export async function listSupplierCategoriesWithExecutor(
  executor: SupplierExecutor,
  schema: SchemaLike,
  usuarioId?: string,
): Promise<SupplierCategoryOption[]> {
  await authorizeUser(executor, schema, usuarioId, ["dueno", "trabajador"]);

  const categories = await executor
    .select({
      id: schema.categoria.categoriaId,
      nombre: schema.categoria.categoriaNombre,
    })
    .from(schema.categoria)
    .orderBy(asc(schema.categoria.categoriaNombre));

  return categories;
}

export async function registerSupplierWithExecutor(
  executor: SupplierExecutor,
  schema: SchemaLike,
  payload: SupplierRegistrationPayload,
): Promise<SupplierRegistrationResponse> {
  const user = await authorizeUser(executor, schema, payload.usuarioId, [
    "dueno",
    "trabajador",
  ]);
  const input = normalizeSupplierRegistrationPayload(payload);
  const fieldErrors = validateSupplierRegistrationPayload(input);

  if (hasSupplierFieldErrors(fieldErrors)) {
    throw new SupplierRegistrationError(
      "validation",
      "Revise los campos marcados antes de continuar.",
      fieldErrors,
    );
  }

  const storedSuppliers = await executor
    .select({
      id: schema.proveedor.proveedorId,
      rut: schema.proveedor.proveedorRut,
    })
    .from(schema.proveedor);
  const requestedKey = rutComparisonKey(input.rut);

  if (
    storedSuppliers.some(
      (supplier) => rutComparisonKey(supplier.rut) === requestedKey,
    )
  ) {
    throw duplicateRutError();
  }

  const existingCategories = await executor
    .select({ id: schema.categoria.categoriaId })
    .from(schema.categoria)
    .where(inArray(schema.categoria.categoriaId, input.categoriaIds));
  const existingCategoryIds = new Set(existingCategories.map(({ id }) => id));
  const missingCategoryIds = input.categoriaIds.filter(
    (categoryId) => !existingCategoryIds.has(categoryId),
  );

  if (missingCategoryIds.length > 0) {
    throw new SupplierRegistrationError(
      "invalid-categories",
      "Una o más categorías seleccionadas no existen.",
      { categoriaIds: "Seleccione únicamente categorías disponibles." },
    );
  }

  let createdSupplier: { id: number };

  try {
    [createdSupplier] = await executor
      .insert(schema.proveedor)
      .values({
        proveedorRut: input.rut,
        proveedorNombreRazonSocial: input.nombreRazonSocial,
        proveedorNombreContacto: input.nombreContacto,
        proveedorTelefono: input.telefono,
        proveedorCorreoElectronico: input.correoElectronico,
      })
      .returning({ id: schema.proveedor.proveedorId });
  } catch (error) {
    if (isSupplierRutUniqueConstraintError(error)) {
      throw duplicateRutError();
    }
    throw error;
  }

  await executor.insert(schema.proveedorCategoria).values(
    input.categoriaIds.map((categoriaId) => ({
      proveedorId: createdSupplier.id,
      categoriaId,
    })),
  );

  await registerAuditLog(executor, schema, {
    tipoAccion: "registro_proveedor",
    modulo: "proveedores",
    descripcion: `Proveedor ${createdSupplier.id} registrado con RUT ${input.rut} y ${input.categoriaIds.length} categoría(s).`,
    usuarioId: user.usuarioId,
  });

  return {
    proveedorId: createdSupplier.id,
    rut: canonicalizeRut(input.rut),
  };
}

function validationResponse(fieldErrors: SupplierFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: "VALIDATION_ERROR" as const,
      controllerId: "supplier-create" as const,
      fieldErrors,
      message: "Revise los campos marcados antes de continuar.",
    },
  };
}

function normalizeSupplierCreateError(error: unknown, channel: string) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "supplier-create" as const,
        message: error.message,
      },
    };
  }

  if (error instanceof SupplierRegistrationError) {
    return validationResponse(error.fieldErrors);
  }

  if (isSupplierRutUniqueConstraintError(error)) {
    return validationResponse({ rut: "El proveedor ya existe." });
  }

  return {
    ok: false as const,
    error: {
      code: "DATABASE_ERROR" as const,
      controllerId: "supplier-create" as const,
      message:
        channel === "proveedor:categorias"
          ? "No fue posible cargar las categorías. Intente nuevamente."
          : "No fue posible registrar el proveedor. Intente nuevamente.",
    },
  };
}

function duplicateRutError(): SupplierRegistrationError {
  return new SupplierRegistrationError(
    "duplicate-rut",
    "El proveedor ya existe.",
    { rut: "El proveedor ya existe." },
  );
}

export function isSupplierRutUniqueConstraintError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.message === "string") messages.push(record.message);
      if (typeof record.code === "string") messages.push(record.code);
      current = record.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }

  const message = messages.join(" ").toLowerCase();
  return (
    (message.includes("unique") || message.includes("sqlite_constraint")) &&
    (message.includes("proveedor_rut") || message.includes("proveedor.proveedor_rut"))
  );
}

export class SupplierRegistrationError extends Error {
  constructor(
    readonly reason:
      | "validation"
      | "duplicate-rut"
      | "invalid-categories",
    message: string,
    readonly fieldErrors: SupplierFieldErrors,
  ) {
    super(message);
  }
}

export const supplierCreateController = createSupplierCreateController();
