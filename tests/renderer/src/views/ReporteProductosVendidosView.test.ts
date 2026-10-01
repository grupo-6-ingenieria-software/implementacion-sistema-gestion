import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductsMostSoldTable } from "../../../../src/renderer/src/views/ReporteProductosVendidosView";
import { evaluateRouteAccess, getVisibleMenu, navigationTree } from "../../../../src/shared/navigation";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import type { ProductsMostSoldReport } from "../../../../src/shared/products-most-sold";

describe("CU48 V39", () => {
  it("mounts the documented route only for the owner", () => {
    const route = navigationTree.find((node) => node.id === "products-most-sold")!;
    expect(route).toMatchObject({ path: "/app/reportes/mas-vendidos", viewName: "ReporteProductosVendidosView", roles: ["dueno"], group: "reportes" });
    expect(getVisibleMenu("trabajador").map((node) => node.id)).not.toContain("products-most-sold");
    expect(evaluateRouteAccess(route.path, { isAuthenticated: true, role: "trabajador" })).toMatchObject({ status: "deny" });
    expect(evaluateRouteAccess(route.path, { isAuthenticated: true, role: "dueno" })).toEqual({ status: "allow" });
    expect(isImplementedViewNodeId("products-most-sold")).toBe(true);
  });

  it("renders all six columns, net pesos, unit percentages and the top rows", () => {
    const report: ProductsMostSoldReport = {
      status: "ready", periodo: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" }, totalUnidadesPeriodo: 3,
      filas: [{ productoId: 1, ean13: "0000000000001", nombre: "Marraqueta", categoria: "Pan", unidadesVendidas: 1, ingresoNeto: 900, porcentajeUnidades: 100 / 3 }],
    };
    const html = renderToStaticMarkup(createElement(ProductsMostSoldTable, { report }));
    expect(html).toContain("EAN");
    expect(html).toContain("Producto");
    expect(html).toContain("Categoría");
    expect(html).toContain("Unidades");
    expect(html).toContain("Ingreso neto");
    expect(html).toContain("% de unidades");
    expect(html).toContain("33,33 %");
    expect(html).toContain("900");
  });
});
