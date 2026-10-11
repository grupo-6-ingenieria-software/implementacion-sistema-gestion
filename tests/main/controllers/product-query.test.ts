import { describe, expect, it } from "vitest";
import type { ControllerResponse } from "../../../src/shared/controllers";
import type { Role } from "../../../src/shared/navigation";
import type {
  ActiveProductSearchItem,
  ProductDetailResponse,
  ProductListItem,
  ProductListResponse,
} from "../../../src/shared/products";
import { createProductQueryController } from "../../../src/main/controllers/product-query";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";

const products: ProductListItem[] = [
  {
    ean13: "7802345600012",
    nombre: "Leche Soprole 1L",
    categoria: "Lacteos",
    categoriaId: 2,
    precioCosto: 950,
    precioVenta: 1390,
    stockActual: 60,
    stockMinimo: 30,
    estado: "activo",
    fechaRegistro: "2026-06-01",
  },
  {
    ean13: "7802920000015",
    nombre: "Coca-Cola 1.5L",
    categoria: "Bebidas",
    categoriaId: 1,
    precioCosto: 1200,
    precioVenta: 1800,
    stockActual: 48,
    stockMinimo: 20,
    estado: "activo",
    fechaRegistro: "2026-06-01",
  },
  {
    ean13: "7800000000122",
    nombre: "Hallulla",
    categoria: "Panaderia",
    categoriaId: 3,
    precioCosto: 150,
    precioVenta: 250,
    stockActual: 0,
    stockMinimo: 50,
    estado: "inactivo",
    fechaRegistro: "2026-06-01",
  },
];

function createController() {
  return createProductQueryController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    listProducts: async ({ filters, includeCost }) =>
      products
        .filter((product) => product.estado === "activo")
        .filter(
          (product) =>
            !filters.categoriaId || product.categoriaId === filters.categoriaId,
        )
        .filter((product) => {
          if (!filters.search) return true;
          return /^\d{13}$/.test(filters.search)
            ? product.ean13 === filters.search
            : product.nombre
                .toLocaleLowerCase("es")
                .includes(filters.search.toLocaleLowerCase("es"));
        })
        .sort((left, right) => {
          const result =
            filters.sortBy === "stockActual"
              ? left.stockActual - right.stockActual
              : left[filters.sortBy].localeCompare(right[filters.sortBy], "es");
          return filters.sortDirection === "asc" ? result : -result;
        })
        .map((product) => {
          if (includeCost) {
            return product;
          }

          const { precioCosto, ...productWithoutCost } = product;
          void precioCosto;
          return productWithoutCost;
        }),
    listCategories: async () => [
      { id: 1, nombre: "Bebidas" },
      { id: 2, nombre: "Lacteos" },
      { id: 3, nombre: "Panaderia" },
    ],
    findProduct: async (ean13, { includeCost }) => {
      const product = products.find((item) => item.ean13 === ean13);

      if (!product) {
        return null;
      }

      const detail = {
        ean13: product.ean13,
        nombre: product.nombre,
        categoriaId: product.categoriaId,
        precioVenta: product.precioVenta,
        stockMinimo: product.stockMinimo,
        estado: product.estado,
      };

      if (!includeCost) {
        return detail;
      }

      return {
        ...detail,
        precioCosto: 1000,
      };
    },
    listActiveProducts: async ({ query, ean13, limit }) => {
      const search = ean13 ?? query ?? "";
      return products
        .filter(
          (product) =>
            product.estado === "activo" &&
            (product.ean13 === search ||
              product.nombre
                .toLocaleLowerCase("es")
                .includes(search.toLocaleLowerCase("es"))),
        )
        .slice(0, limit)
        .map<ActiveProductSearchItem>((product) => ({
          productoId: product.categoriaId,
          ean13: product.ean13,
          nombre: product.nombre,
          categoria: product.categoria,
          exigeVencimiento: product.categoria === "Lacteos",
          precioVenta: product.precioVenta,
          stockDisponible: product.stockActual,
        }));
    },
  });
}

async function invokeProductList(
  payload?: unknown,
): Promise<ControllerResponse<ProductListResponse>> {
  return createController().handle(payload, {
    channel: "producto:listar",
  }) as Promise<ControllerResponse<ProductListResponse>>;
}

async function invokeProductDetail(
  payload?: unknown,
): Promise<ControllerResponse<ProductDetailResponse>> {
  return createController().handle(payload, {
    channel: "producto:estado",
  }) as Promise<ControllerResponse<ProductDetailResponse>>;
}

describe("controlador de consulta de productos", () => {
  it("lista productos activos por defecto con datos de stock", async () => {
    const response = await invokeProductList({ usuarioId: "dueno" });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products).toHaveLength(2);
    expect(response.data.products[0]).toMatchObject({
      ean13: "7802920000015",
      nombre: "Coca-Cola 1.5L",
      precioCosto: 1200,
      stockActual: 48,
    });
    expect(response.data.categories).toHaveLength(3);
  });

  it("filtra productos por nombre y EAN-13", async () => {
    const byName = await invokeProductList({
      search: "leche",
      usuarioId: "dueno",
    });
    const byEan = await invokeProductList({
      search: "7802920000015",
      usuarioId: "dueno",
    });

    expect(byName.ok).toBe(true);
    expect(byEan.ok).toBe(true);
    if (!byName.ok || !byEan.ok) {
      throw new Error("Expected successful product queries");
    }

    expect(byName.data.products.map((product) => product.nombre)).toEqual([
      "Leche Soprole 1L",
    ]);
    expect(byEan.data.products.map((product) => product.nombre)).toEqual([
      "Coca-Cola 1.5L",
    ]);
  });

  it("exige un EAN-13 exacto en el listado CU6", async () => {
    const response = await invokeProductList({
      search: "292000001",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.data.products).toEqual([]);
  });

  it("carga los productos antes que las opciones de categoría", async () => {
    const calls: string[] = [];
    const controller = createProductQueryController({
      authorize: async (usuarioId, roles) =>
        authorizeTestUser(usuarioId, roles),
      listProducts: async () => {
        calls.push("products");
        return [];
      },
      listCategories: async () => {
        calls.push("categories");
        return [];
      },
      findProduct: async () => null,
      listActiveProducts: async () => [],
    });

    await controller.handle(
      { usuarioId: "dueno" },
      { channel: "producto:listar" },
    );
    expect(calls).toEqual(["products", "categories"]);
  });

  it("devuelve una lista vacía cuando los filtros no coinciden con productos", async () => {
    const response = await invokeProductList({
      search: "producto inexistente",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products).toEqual([]);
  });

  it("mantiene el listado CU6 activo aunque se solicite otro estado", async () => {
    const response = await invokeProductList({
      estado: "todos",
      sortBy: "stockActual",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products).toHaveLength(2);
    expect(
      response.data.products.every((product) => product.estado === "activo"),
    ).toBe(true);
  });

  it("omite datos de costo en las listas de productos para trabajador", async () => {
    const response = await invokeProductList({ usuarioId: "trabajador" });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products[0]).not.toHaveProperty("precioCosto");
  });

  it("rechaza listas de productos sin usuario autorizado", async () => {
    const response = await invokeProductList();

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden product list");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("busca productos activos con requisito de vencimiento para el registro de lotes", async () => {
    const response = (await createController().handle(
      {
        query: "leche",
        limit: 10,
        usuarioId: "dueno",
      },
      { channel: "producto:buscar-activo" },
    )) as ControllerResponse<ActiveProductSearchItem[]>;

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data).toEqual([
      expect.objectContaining({
        ean13: "7802345600012",
        exigeVencimiento: true,
      }),
    ]);
  });

  it("exige EAN-13 exacto y conserva la búsqueda parcial por nombre para productos activos", async () => {
    const response = (await createController().handle(
      {
        query: "292000001",
        limit: 10,
        usuarioId: "trabajador",
      },
      { channel: "producto:buscar-activo" },
    )) as ControllerResponse<ActiveProductSearchItem[]>;

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("Expected exact EAN miss");
    expect(response.error.code).toBe("BUSINESS_RULE");
  });

  it("lista productos activos cuando la búsqueda está vacía para el registro de ventas", async () => {
    const response = (await createController().handle(
      {
        query: "",
        limit: 10,
        usuarioId: "trabajador",
      },
      { channel: "producto:buscar-activo" },
    )) as ControllerResponse<ActiveProductSearchItem[]>;

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.map((product) => product.nombre)).toEqual([
      "Leche Soprole 1L",
      "Coca-Cola 1.5L",
    ]);
  });

  it("incluye datos de costo en el detalle del producto para el dueno", async () => {
    const response = await invokeProductDetail({
      ean13: "7802920000015",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.product).toHaveProperty("precioCosto", 1000);
  });

  it("omite datos de costo del detalle del producto para trabajadores", async () => {
    const response = await invokeProductDetail({
      ean13: "7802920000015",
      usuarioId: "trabajador",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.product).not.toHaveProperty("precioCosto");
  });

  it("permite a trabajadores cargar el detalle del producto para cambios de estado", async () => {
    const response = await invokeProductDetail({
      ean13: "7802920000015",
      usuarioId: "trabajador",
    });

    expect(response.ok).toBe(true);
  });

  it("devuelve no encontrado antes que las categorías cuando falta el detalle del producto", async () => {
    const calls: string[] = [];
    const controller = createProductQueryController({
      authorize: async (usuarioId, roles) =>
        authorizeTestUser(usuarioId, roles),
      listProducts: async () => [],
      listCategories: async () => {
        calls.push("categories");
        return [];
      },
      findProduct: async () => {
        calls.push("product");
        return null;
      },
      listActiveProducts: async () => [],
    });
    const response = await controller.handle(
      { ean13: "7802920000992", usuarioId: "dueno" },
      { channel: "producto:estado" },
    );
    expect(response).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(calls).toEqual(["product"]);
  });

  it("exige autorización para buscar productos activos", async () => {
    const response = (await createController().handle(
      {
        query: "leche",
        limit: 10,
      },
      { channel: "producto:buscar-activo" },
    )) as ControllerResponse<ActiveProductSearchItem[]>;

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden active product search");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });
});

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role =
    usuarioId === "dueno"
      ? "dueno"
      : usuarioId === "trabajador"
        ? "trabajador"
        : null;

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? "",
    usuarioRol: role,
    trabajadorNombre: role === "dueno" ? "Dueno Prueba" : "Trabajador Prueba",
  };
}
