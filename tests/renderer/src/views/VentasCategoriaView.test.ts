import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import { ComprobanteVentaCategoria } from "../../../../src/renderer/src/views/SaleRegisterView";
import {
  SaleCategoryBreakdown,
  VentasCategoriaView,
} from "../../../../src/renderer/src/views/VentasCategoriaView";
import { navigationTree } from "../../../../src/shared/navigation";
import type { SaleReceipt } from "../../../../src/shared/sales";

describe("CU45 renderer", () => {
  it("mounts V35 for both roles with only dates as input", () => {
    const node = navigationTree.find((item) => item.id === "sale-categories");
    expect(node).toMatchObject({
      path: "/app/ventas/categorias",
      roles: ["dueno", "trabajador"],
      showInMenu: true,
    });
    expect(isImplementedViewNodeId("sale-categories")).toBe(true);
    const markup = renderToStaticMarkup(createElement(VentasCategoriaView));
    expect(markup).toContain("Fecha de inicio");
    expect(markup).toContain("Fecha de término");
    expect(markup).toContain("Consultar");
    expect(markup).not.toContain("Exportar");
  });

  it("shows category rows, exact totals and a successful empty result", () => {
    const filled = renderToStaticMarkup(createElement(SaleCategoryBreakdown, {
      result: {
        categorias: [
          { categoriaId: 1, categoriaNombre: "Abarrotes", unidadesVendidas: 2, montoNeto: 199 },
          { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 1, montoNeto: 100 },
        ],
        totales: { unidadesVendidas: 3, montoNeto: 299 },
      },
    }));
    expect(filled).toContain("Abarrotes");
    expect(filled).toContain("Bebidas");
    expect(filled).toContain("Unidades vendidas");
    expect(filled).toContain("Ingreso neto");
    expect(filled).toContain("299");

    const empty = renderToStaticMarkup(createElement(SaleCategoryBreakdown, {
      result: { categorias: [], totales: { unidadesVendidas: 0, montoNeto: 0 } },
    }));
    expect(empty).toContain("No hay ventas vigentes en el período seleccionado.");
    expect(empty).toContain("$ 0");
  });

  it("shows the confirmed category on every receipt line", () => {
    const receipt: SaleReceipt = {
      ventaId: "00000000-0000-4000-8000-000000000401",
      fechaHora: "2026-06-12T17:00:00.000Z",
      responsable: { usuarioId: "12345678-9", nombre: "Ana", rol: "trabajador" },
      metodoPago: "debito",
      subtotal: 300,
      descuento: { tipo: "monto", valor: 1, razon: "Promoción" },
      total: 299,
      detalle: [
        {
          productoId: 1, ean13: "7802920000015", nombre: "Pan", categoria: "Abarrotes",
          precioUnitario: 100, historialPrecioProductoId: "h1", stockDisponible: 2,
          exigeVencimiento: false, cantidad: 2, subtotal: 200, lotesConsumidos: [],
        },
        {
          productoId: 2, ean13: "7802920000022", nombre: "Agua", categoria: "Bebidas",
          precioUnitario: 100, historialPrecioProductoId: "h2", stockDisponible: 1,
          exigeVencimiento: false, cantidad: 1, subtotal: 100, lotesConsumidos: [],
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ComprobanteVentaCategoria, { receipt }));
    expect(markup).toContain("Categoría: Abarrotes");
    expect(markup).toContain("Categoría: Bebidas");
    expect(markup).toContain("299");
  });
});
