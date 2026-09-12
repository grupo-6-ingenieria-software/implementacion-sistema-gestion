import { asc, eq } from "drizzle-orm";
import { controllers } from "../../shared/controllers";
import { rutComparisonKey } from "../../shared/rut";
import {
  normalizeSupplierListRequest,
  normalizeSupplierLookupRequest,
  type SupplierCategoryOption,
  type SupplierDetail,
  type SupplierListItem,
  type SupplierListRequest,
  type SupplierListResponse,
} from "../../shared/suppliers";
import type { RegisteredController } from "./base";
import { AccessDeniedError, authorizeUser } from "./auth-context";

type SchemaLike = typeof import("../../db/schema");
type SupplierQueryExecutor = Pick<
  typeof import("../../db/client").db,
  "insert" | "select"
>;

type SupplierQueryData = SupplierListResponse | SupplierDetail;

type SupplierQueryDependencies = {
  listSuppliers: (request: SupplierListRequest) => Promise<SupplierListResponse>;
  findSupplier: (
    request: { rut: string; usuarioId?: string },
  ) => Promise<SupplierDetail | null>;
};

export function createSupplierQueryController(
  dependencies: SupplierQueryDependencies = supplierQueryDependencies,
): RegisteredController<unknown, SupplierQueryData> {
  const metadata = controllers.find(
    (controller) => controller.id === "supplier-query",
  );

  if (!metadata) {
    throw new Error("Falta declarar el controlador supplier-query.");
  }

  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel === "proveedor:listar") {
        try {
          return {
            ok: true,
            data: await dependencies.listSuppliers(
              normalizeSupplierListRequest(payload),
            ),
          };
        } catch (error) {
          return normalizeSupplierQueryError(error, "list");
        }
      }

      if (context.channel === "proveedor:buscar-existente") {
        const request = normalizeSupplierLookupRequest(payload);

        if (!request.rut) {
          return {
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              controllerId: "supplier-query",
              fieldErrors: { rut: "Ingrese un RUT chileno válido." },
              message: "Debe indicar un proveedor válido.",
            },
          };
        }

        try {
          const supplier = await dependencies.findSupplier(request);

          if (!supplier) {
            return {
              ok: false,
              error: {
                code: "NOT_FOUND",
                controllerId: "supplier-query",
                message: "No se encontró el proveedor solicitado.",
              },
            };
          }

          return { ok: true, data: supplier };
        } catch (error) {
          return normalizeSupplierQueryError(error, "detail");
        }
      }

      return {
        ok: false,
        error: {
          code: "INVALID_CHANNEL",
          controllerId: "supplier-query",
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    },
  };
}

const supplierQueryDependencies: SupplierQueryDependencies = {
  listSuppliers: async (request) => {
    const { db, schema } = await import("../../db/client");
    return db.transaction((tx) =>
      listSuppliersWithExecutor(tx, schema, request),
    );
  },
  findSupplier: async (request) => {
    const { db, schema } = await import("../../db/client");
    return db.transaction((tx) =>
      findSupplierWithExecutor(tx, schema, request),
    );
  },
};

export async function listSuppliersWithExecutor(
  executor: SupplierQueryExecutor,
  schema: SchemaLike,
  request: SupplierListRequest,
): Promise<SupplierListResponse> {
  const input = normalizeSupplierListRequest(request);

  await authorizeUser(executor, schema, input.usuarioId, [
    "dueno",
    "trabajador",
  ]);

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

  const categories = await executor
    .select({
      id: schema.categoria.categoriaId,
      nombre: schema.categoria.categoriaNombre,
    })
    .from(schema.categoria);

  const associations = await executor
    .select({
      proveedorId: schema.proveedorCategoria.proveedorId,
      id: schema.categoria.categoriaId,
      nombre: schema.categoria.categoriaNombre,
    })
    .from(schema.proveedorCategoria)
    .innerJoin(
      schema.categoria,
      eq(schema.proveedorCategoria.categoriaId, schema.categoria.categoriaId),
    );

  const categoriesBySupplier = new Map<number, SupplierCategoryOption[]>();

  for (const association of associations) {
    const supplierCategories =
      categoriesBySupplier.get(association.proveedorId) ?? [];
    supplierCategories.push({ id: association.id, nombre: association.nombre });
    categoriesBySupplier.set(association.proveedorId, supplierCategories);
  }

  const items: SupplierListItem[] = suppliers.map((supplier) => ({
    ...supplier,
    categorias: [...(categoriesBySupplier.get(supplier.proveedorId) ?? [])].sort(
      compareCategoryOptions,
    ),
  }));

  const textKey = normalizeSearchText(input.busqueda ?? "");
  const rutKey = rutComparisonKey(input.busqueda ?? "");

  const filteredSuppliers = items
    .filter((supplier) => {
      const matchesSearch =
        !textKey ||
        normalizeSearchText(supplier.nombreRazonSocial).includes(textKey) ||
        rutComparisonKey(supplier.rut).includes(rutKey);
      const matchesCategory =
        !input.categoriaId ||
        supplier.categorias.some(
          (category) => category.id === input.categoriaId,
        );

      return matchesSearch && matchesCategory;
    })
    .sort(compareSuppliers);

  return {
    suppliers: filteredSuppliers,
    categories: [...categories].sort(compareCategoryOptions),
  };
}

const spanishCollator = new Intl.Collator("es", { sensitivity: "base" });

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function compareCategoryOptions(
  left: SupplierCategoryOption,
  right: SupplierCategoryOption,
): number {
  return (
    spanishCollator.compare(left.nombre, right.nombre) ||
    left.nombre.localeCompare(right.nombre, "es") ||
    left.id - right.id
  );
}

function compareSuppliers(
  left: SupplierListItem,
  right: SupplierListItem,
): number {
  return (
    spanishCollator.compare(left.nombreRazonSocial, right.nombreRazonSocial) ||
    left.nombreRazonSocial.localeCompare(right.nombreRazonSocial, "es") ||
    left.proveedorId - right.proveedorId
  );
}

export async function findSupplierWithExecutor(
  executor: SupplierQueryExecutor,
  schema: SchemaLike,
  request: { rut: string; usuarioId?: string },
): Promise<SupplierDetail | null> {
  await authorizeUser(executor, schema, request.usuarioId, [
    "dueno",
    "trabajador",
  ]);

  const suppliers = await executor
    .select({
      proveedorId: schema.proveedor.proveedorId,
      rut: schema.proveedor.proveedorRut,
      nombreRazonSocial: schema.proveedor.proveedorNombreRazonSocial,
      nombreContacto: schema.proveedor.proveedorNombreContacto,
      telefono: schema.proveedor.proveedorTelefono,
      correoElectronico: schema.proveedor.proveedorCorreoElectronico,
    })
    .from(schema.proveedor)
    .orderBy(asc(schema.proveedor.proveedorId));
  const requestedKey = rutComparisonKey(request.rut);
  const supplier = suppliers.find(
    (candidate) => rutComparisonKey(candidate.rut) === requestedKey,
  );

  if (!supplier) {
    return null;
  }

  const categories = await executor
    .select({ categoriaId: schema.proveedorCategoria.categoriaId })
    .from(schema.proveedorCategoria)
    .where(eq(schema.proveedorCategoria.proveedorId, supplier.proveedorId))
    .orderBy(asc(schema.proveedorCategoria.categoriaId));

  return {
    ...supplier,
    categoriaIds: categories.map(({ categoriaId }) => categoriaId),
  };
}

function normalizeSupplierQueryError(error: unknown, operation: "list" | "detail") {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: "FORBIDDEN" as const,
        controllerId: "supplier-query" as const,
        message: error.message,
      },
    };
  }

  return {
    ok: false as const,
    error: {
      code: "DATABASE_ERROR" as const,
      controllerId: "supplier-query" as const,
      message:
        operation === "list"
          ? "No fue posible cargar los proveedores. Intente nuevamente."
          : "No fue posible cargar el proveedor. Intente nuevamente.",
    },
  };
}

export const supplierQueryController = createSupplierQueryController();
