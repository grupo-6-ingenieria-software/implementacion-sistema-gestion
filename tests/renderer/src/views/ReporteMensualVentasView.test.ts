import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthlySalesSummary, MonthlySalesTables } from "../../../../src/renderer/src/views/ReporteMensualVentasView";
import { evaluateRouteAccess, getVisibleGroups, navigationTree } from "../../../../src/shared/navigation";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import type { MonthlySalesReport } from "../../../../src/shared/monthly-sales";

describe("V38 monthly sales", () => {
  it("adds only the documented monthly route and restricts it to the owner", () => {
    const route = navigationTree.find((node) => node.id === "monthly-sales")!;
    expect(route).toMatchObject({ path: "/app/reportes/ventas-mensuales", viewName: "ReporteMensualVentasView", group: "reportes", roles: ["dueno"] });
    expect(getVisibleGroups("trabajador")).not.toContain("reportes");
    expect(evaluateRouteAccess(route.path, { isAuthenticated: true, role: "trabajador" })).toMatchObject({ status: "deny", to: "/app/inicio" });
    expect(evaluateRouteAccess(route.path, { isAuthenticated: true, role: "dueno" })).toEqual({ status: "allow" });
    expect(isImplementedViewNodeId("monthly-sales")).toBe(true);
  });

  it("renders daily zero values, payment summaries and N/A", () => {
    const report: MonthlySalesReport = {
      periodo: { mes: 9, anio: 2026 }, dias: [{ fecha: "2026-09-01", transacciones: 1, monto: 2000 }, { fecha: "2026-09-02", transacciones: 0, monto: 0 }],
      metodos: [{ metodo: "debito", transacciones: 1, monto: 2000 }], transacciones: 1, montoTotal: 2000, montoMesAnterior: 0, variacionPorcentual: null,
    };
    const tables = renderToStaticMarkup(createElement(MonthlySalesTables, { report }));
    expect(tables).toContain("02/09/2026");
    expect(tables).toContain("Débito");
    expect(renderToStaticMarkup(createElement(MonthlySalesSummary, { report }))).toContain("N/A");
  });
});
