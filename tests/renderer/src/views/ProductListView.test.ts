import { describe, expect, it } from "vitest";
import type { ProductListItem } from "../../../../src/shared/products";
import {
  getProductActionsForRole,
  orderProductsForList,
} from "../../../../src/renderer/src/views/ProductListView";

const product: ProductListItem = {
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
};

const inactiveProduct: ProductListItem = {
  ...product,
  ean13: "7800000000122",
  nombre: "Hallulla",
  estado: "inactivo",
};

describe("acciones de ProductListView", () => {
  it("muestra las acciones administrativas de producto al dueño", () => {
    expect(
      getProductActionsForRole("dueno", product).map((action) => action.label),
    ).toEqual([
      "Ver detalle",
      "Editar",
      "Cambiar estado",
      "Eliminar",
      "Registrar lote",
      "Registrar merma",
    ]);
  });

  it("muestra solo las acciones operativas de producto al trabajador", () => {
    expect(
      getProductActionsForRole("trabajador", product).map(
        (action) => action.label,
      ),
    ).toEqual(["Ver detalle", "Cambiar estado", "Eliminar", "Registrar merma"]);
  });

  it("oculta las operaciones de producto activo en productos inactivos", () => {
    expect(
      getProductActionsForRole("dueno", inactiveProduct).map(
        (action) => action.label,
      ),
    ).toEqual(["Ver detalle", "Editar", "Cambiar estado", "Eliminar"]);
    expect(
      getProductActionsForRole("trabajador", inactiveProduct).map(
        (action) => action.label,
      ),
    ).toEqual(["Ver detalle", "Cambiar estado", "Eliminar"]);
  });

  it("mantiene los productos inactivos al final de la lista", () => {
    expect(orderProductsForList([inactiveProduct, product])).toEqual([
      product,
      inactiveProduct,
    ]);
  });
});
