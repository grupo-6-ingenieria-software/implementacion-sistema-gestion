import { describe, expect, it } from "vitest";
import {
  APP_HOME_PATH,
  PASSWORD_CHANGE_PATH,
  PUBLIC_LOGIN_PATH,
  evaluateRouteAccess,
  getVisibleGroups,
  getVisibleMenu,
  internalComponents,
  navigationTree,
  validateNavigationTree,
} from "../../src/shared/navigation";

describe("árbol de navegación", () => {
  it("registra CU20 para ambos roles de V06 y mantiene UI06/UI07 como internos", () => {
    const route = navigationTree.find((node) => node.id === "product-list")!;
    expect(route.roles).toEqual(["dueno", "trabajador"]);
    expect(route.controllerIds).toContain("inventory-export");
    for (const name of ["AccionExportarFormato", "ReportePrintView"]) {
      const component = internalComponents.find((component) => component.name === name)!;
      expect(component.usedIn).toEqual(["product-list", "monthly-sales", "attendance-report"]);
      expect(component.controllerIds).toEqual(["inventory-export", "restock-report-export", "report-export"]);
      expect(navigationTree.some((node) => (node.viewName as string) === name)).toBe(false);
    }
  });
  it("traza UI01 hasta sus consumidores sin declarar una ruta de escáner", () => {
    const component = internalComponents.find((item) => item.id === "ean-input")!;
    expect(component.usedIn).toEqual(expect.arrayContaining([
      "product-list", "product-create", "product-edit", "product-delete",
      "lot-create", "waste-create", "stock-adjustment", "movement-history",
      "sale-register", "supplier-order-create",
    ]));
    for (const id of component.usedIn) {
      expect(navigationTree.find((node) => node.id === id)?.controllerIds).toContain("ean-reader");
    }
    expect(navigationTree.some((node) => (node.id as string) === "ean-reader")).toBe(false);
  });
  it("declara cada ruta sin errores estructurales", () => {
    expect(validateNavigationTree()).toEqual([]);
    expect(new Set(navigationTree.map((node) => node.id))).toEqual(
      new Set([
        "login",
        "password-change",
        "dashboard",
        "product-list",
        "product-create",
        "product-edit",
        "product-status",
        "product-delete",
        "lot-create",
        "waste-create",
        "supplier-list",
        "supplier-create",
        "supplier-edit",
        "supplier-order-create",
        "supplier-order-receptions",
        "sale-register",
        "sale-categories",
        "daily-sales",
        "sales-query",
        "sale-annulment",
        "cash-closing",
        "worker-list",
        "worker-create",
        "shift-calendar",
        "shift-create",
        "shift-edit",
        "attendance",
        "absence-create",
        "attendance-monthly-summary",
        "attendance-report",
        "remuneracion-create",
        "configuracion-previsional",
        "user-management",
        "audit-log",
        "product-detail",
        "stock-adjustment",
        "movement-history",
        "restock-list",
        "inventory-valuation",
        "daily-sales-report",
        "monthly-sales",
        "category-profitability",
        "products-most-sold",
        "reporte-mermas",
        "reporte-lotes-vencer",
        "reporte-movimientos",
      ]),
    );
  });

  it("expone V35 en Ventas para ambos roles y protege su ruta", () => {
    expect(navigationTree.find((node) => node.id === "sale-categories")).toMatchObject({
      path: "/app/ventas/categorias",
      roles: ["dueno", "trabajador"],
      group: "ventas",
      showInMenu: true,
      controllerIds: ["access-control", "sale-categories"],
    });
    for (const role of ["dueno", "trabajador"] as const) {
      expect(evaluateRouteAccess("/app/ventas/categorias", {
        isAuthenticated: true,
        role,
      })).toEqual({ status: "allow" });
    }
  });

  it("expone V28 una vez en Inventario para ambos roles", () => {
    const route = navigationTree.find(
      (node) => node.id === "inventory-valuation",
    );
    expect(route).toMatchObject({
      viewName: "ValorizacionInventarioView",
      label: "Valor de inventario",
      path: "/app/inventario/valorizacion",
      roles: ["dueno", "trabajador"],
      group: "inventario",
      showInMenu: true,
      controllerIds: ["access-control", "inventory-valuation"],
    });

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        getVisibleMenu(role).filter(
          (node) => node.path === "/app/inventario/valorizacion",
        ),
      ).toHaveLength(1);
      expect(
        evaluateRouteAccess("/app/inventario/valorizacion", {
          isAuthenticated: true,
          role,
        }),
      ).toEqual({ status: "allow" });
    }
  });

  it("expone V37 solo al Dueño, incluso por ruta directa", () => {
    const path = "/app/reportes/ventas-diarias";
    expect(navigationTree.find((node) => node.path === path)).toMatchObject({
      id: "daily-sales-report", roles: ["dueno"], group: "reportes", showInMenu: true,
      controllerIds: ["access-control", "daily-sales-report", "report-export", "audit"],
    });
    expect(getVisibleMenu("dueno").map((node) => node.path)).toContain(path);
    expect(getVisibleMenu("trabajador").map((node) => node.path)).not.toContain(path);
    expect(evaluateRouteAccess(path, { isAuthenticated: true, role: "dueno" })).toEqual({ status: "allow" });
    expect(evaluateRouteAccess(path, { isAuthenticated: true, role: "trabajador" }).status).toBe("deny");
  });

  it("delega la denegación del registro de auditoría a Main para CU58-E1", () => {
    expect(
      evaluateRouteAccess("/app/admin/auditoria", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toEqual({ status: "allow" });
    expect(getVisibleMenu("trabajador").map((node) => node.id)).not.toContain(
      "audit-log",
    );
    expect(
      evaluateRouteAccess("/app/admin/usuarios", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toMatchObject({ status: "deny", to: "/app/inicio" });
  });

  it("expone V25 una vez en Inventario para ambos roles y mantiene UI05 como interno", () => {
    const route = navigationTree.find((node) => node.id === "restock-list");
    expect(route).toMatchObject({
      path: "/app/inventario/reabastecimiento",
      roles: ["dueno", "trabajador"],
      group: "inventario",
      showInMenu: true,
      controllerIds: [
        "access-control",
        "restock-list",
        "restock-report-export",
      ],
    });

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        getVisibleMenu(role).filter(
          (node) => node.path === "/app/inventario/reabastecimiento",
        ),
      ).toHaveLength(1);
      expect(
        evaluateRouteAccess("/app/inventario/reabastecimiento", {
          isAuthenticated: true,
          role,
        }),
      ).toEqual({ status: "allow" });
    }

    expect(internalComponents).toContainEqual({
      id: "restock-print-view",
      name: "ListaReabastecimientoPrintView",
      usedIn: ["restock-list"],
      controllerIds: ["restock-report-export"],
    });
  });

  it("agrega V23 a ambos menús y mantiene V24 como destino de navegación interno", () => {
    for (const role of ["dueno", "trabajador"] as const) {
      const menuPaths = getVisibleMenu(role).map((node) => node.path);
      expect(menuPaths).toContain("/app/proveedores/listado");
      expect(menuPaths).not.toContain("/app/proveedores/nuevo");
      expect(
        evaluateRouteAccess("/app/proveedores/nuevo", {
          isAuthenticated: true,
          role,
        }),
      ).toEqual({ status: "allow" });
    }
  });

  it("permite a ambos roles editar proveedores mediante la ruta dinámica interna", () => {
    const editNode = navigationTree.find((node) => node.id === "supplier-edit");
    expect(editNode).toMatchObject({
      path: "/app/proveedores/:rut/editar",
      showInMenu: false,
    });

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        evaluateRouteAccess("/app/proveedores/12.345.678-5/editar", {
          isAuthenticated: true,
          role,
        }),
      ).toEqual({ status: "allow" });
      expect(getVisibleMenu(role).map((node) => node.id)).not.toContain(
        "supplier-edit",
      );
    }
  });

  it("mantiene los componentes internos de UI fuera de rutas y menús", () => {
    const routeIds = new Set<string>(navigationTree.map((node) => node.id));
    const menuLabels = new Set<string>(
      navigationTree
        .filter((node) => node.showInMenu)
        .map((node) => node.label),
    );

    for (const component of internalComponents) {
      expect(routeIds.has(component.id)).toBe(false);
      expect(menuLabels.has(component.name)).toBe(false);
    }
  });

  it("filtra los grupos de menú por rol", () => {
    expect(getVisibleGroups("dueno")).toEqual([
      "inicio",
      "inventario",
      "proveedores",
      "ventas",
      "caja",
      "personal",
      "reportes",
      "administracion",
    ]);

    expect(getVisibleGroups("trabajador")).toEqual([
      "inicio",
      "inventario",
      "proveedores",
      "ventas",
      "caja",
      "personal",
    ]);

    expect(getVisibleMenu("trabajador").map((node) => node.path)).not.toContain(
      "/app/admin/usuarios",
    );
  });

  it("protege sesión, cambio de contraseña y acceso por rol", () => {
    expect(
      evaluateRouteAccess("/app/inicio", { isAuthenticated: false }),
    ).toEqual({
      status: "redirect",
      to: PUBLIC_LOGIN_PATH,
      reason: "missing-session",
    });

    expect(
      evaluateRouteAccess("/app/inicio", {
        isAuthenticated: true,
        role: "trabajador",
        passwordChangeRequired: true,
      }),
    ).toEqual({
      status: "redirect",
      to: PASSWORD_CHANGE_PATH,
      reason: "password-change-required",
    });

    expect(
      evaluateRouteAccess("/app/admin/usuarios", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toEqual({
      status: "deny",
      to: APP_HOME_PATH,
      reason: "role-denied",
      auditControllerId: "audit",
    });

    expect(
      evaluateRouteAccess("/app/admin/usuarios", {
        isAuthenticated: true,
        role: "dueno",
      }),
    ).toEqual({ status: "allow" });
  });

  it("permite a ambos roles soportados acceder a las ventas diarias", () => {
    expect(
      evaluateRouteAccess("/app/ventas/dia", {
        isAuthenticated: true,
        role: "dueno",
      }),
    ).toEqual({ status: "allow" });
    expect(
      evaluateRouteAccess("/app/ventas/dia", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toEqual({ status: "allow" });
  });

  it("abre la lista de trabajadores a ambos roles mientras el formulario de creación sigue exclusivo de dueno (CU24)", () => {
    const listNode = navigationTree.find((item) => item.id === "worker-list");
    expect(listNode).toMatchObject({
      path: "/app/personal/trabajadores",
      roles: ["dueno", "trabajador"],
    });
    const createNode = navigationTree.find(
      (item) => item.id === "worker-create",
    );
    expect(createNode).toMatchObject({
      path: "/app/personal/trabajadores/nuevo",
      roles: ["dueno"],
    });

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        evaluateRouteAccess("/app/personal/trabajadores", {
          isAuthenticated: true,
          role,
        }),
      ).toEqual({ status: "allow" });
    }

    expect(
      evaluateRouteAccess("/app/personal/trabajadores/nuevo", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toEqual({
      status: "deny",
      to: APP_HOME_PATH,
      reason: "role-denied",
      auditControllerId: "audit",
    });
    expect(
      getVisibleMenu("trabajador").map((node) => node.path),
    ).toContain("/app/personal/trabajadores");
  });

  it("expone CU38 a ambos roles desde el menú de ventas", () => {
    const node = navigationTree.find((item) => item.id === "sale-annulment");
    expect(node).toMatchObject({
      path: "/app/ventas/anular",
      showInMenu: true,
      roles: ["dueno", "trabajador"],
    });

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        evaluateRouteAccess(
          "/app/ventas/anular?ventaId=00000000-0000-4000-8000-000000000401",
          { isAuthenticated: true, role },
        ),
      ).toEqual({ status: "allow" });
    }
  });

  it("expone CU41 a ambos roles desde el menú de ventas", () => {
    const node = navigationTree.find((item) => item.id === "sales-query");
    expect(node).toMatchObject({
      path: "/app/ventas/consulta",
      showInMenu: true,
      roles: ["dueno", "trabajador"],
      controllerIds: ["access-control", "sales-history", "receipt-print"],
    });

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        evaluateRouteAccess(
          "/app/ventas/consulta?criterio=rango&fechaInicio=2026-09-11&fechaTermino=2026-09-11",
          { isAuthenticated: true, role },
        ),
      ).toEqual({ status: "allow" });
    }
  });

  it("permite a ambos roles acceder a la eliminación de productos fuera del menú", () => {
    const productDeleteNode = navigationTree.find(
      (node) => node.id === "product-delete",
    );

    expect(productDeleteNode?.showInMenu).toBe(false);
    expect(getVisibleMenu("dueno").map((node) => node.id)).not.toContain(
      "product-delete",
    );
    expect(getVisibleMenu("trabajador").map((node) => node.id)).not.toContain(
      "product-delete",
    );

    for (const role of ["dueno", "trabajador"] as const) {
      expect(
        evaluateRouteAccess(
          "/app/inventario/productos/eliminar?ean13=7802920000015",
          {
            isAuthenticated: true,
            role,
          },
        ),
      ).toEqual({ status: "allow" });
    }
  });

  it("mantiene la creación de turnos exclusiva del dueño (el calendario de CU28 es compartido)", () => {
    for (const path of ["/app/personal/turnos/nuevo", "/app/personal/turnos/turno-id/editar"]) {
      expect(
        evaluateRouteAccess(path, {
          isAuthenticated: true,
          role: "dueno",
        }),
      ).toEqual({ status: "allow" });
      expect(
        evaluateRouteAccess(path, {
          isAuthenticated: true,
          role: "trabajador",
        }),
      ).toMatchObject({
        status: "deny",
        to: APP_HOME_PATH,
      });
    }
  });

  it("permite solo al dueño acceder a V30 y V31", () => {
    for (const path of [
      "/app/personal/remuneraciones/nueva",
      "/app/personal/configuracion-previsional",
    ]) {
      expect(
        evaluateRouteAccess(path, {
          isAuthenticated: true,
          role: "dueno",
        }),
      ).toEqual({ status: "allow" });
      expect(
        evaluateRouteAccess(path, {
          isAuthenticated: true,
          role: "trabajador",
        }),
      ).toMatchObject({
        status: "deny",
        to: APP_HOME_PATH,
      });
    }
  });

  it("expone V40 ReporteMermasView exclusivamente al dueño en Reportes", () => {
    const route = navigationTree.find((node) => node.id === "reporte-mermas");
    expect(route).toMatchObject({
      viewName: "ReporteMermasView",
      label: "Mermas",
      path: "/app/reportes/mermas",
      roles: ["dueno"],
      group: "reportes",
      showInMenu: true,
      controllerIds: ["access-control", "waste-report", "audit"],
    });

    expect(
      evaluateRouteAccess("/app/reportes/mermas", {
        isAuthenticated: true,
        role: "dueno",
      }),
    ).toEqual({ status: "allow" });

    expect(
      evaluateRouteAccess("/app/reportes/mermas", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toMatchObject({
      status: "deny",
      to: APP_HOME_PATH,
    });

    expect(getVisibleMenu("dueno").map((node) => node.id)).toContain("reporte-mermas");
    expect(getVisibleMenu("trabajador").map((node) => node.id)).not.toContain("reporte-mermas");
  });

  it("expone V41 ReporteLotesVencerView exclusivamente al dueño en Reportes", () => {
    const route = navigationTree.find(
      (node) => node.id === "reporte-lotes-vencer",
    );
    expect(route).toMatchObject({
      viewName: "ReporteLotesVencerView",
      label: "Lotes por vencer",
      path: "/app/reportes/lotes-por-vencer",
      roles: ["dueno"],
      group: "reportes",
      showInMenu: true,
      controllerIds: ["access-control", "expiring-lots-report", "audit"],
    });

    expect(
      evaluateRouteAccess("/app/reportes/lotes-por-vencer", {
        isAuthenticated: true,
        role: "dueno",
      }),
    ).toEqual({ status: "allow" });

    expect(
      evaluateRouteAccess("/app/reportes/lotes-por-vencer", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toMatchObject({
      status: "deny",
      to: APP_HOME_PATH,
    });

    expect(getVisibleMenu("dueno").map((node) => node.id)).toContain(
      "reporte-lotes-vencer",
    );
    expect(getVisibleMenu("trabajador").map((node) => node.id)).not.toContain(
      "reporte-lotes-vencer",
    );
  });

  it("expone V44 ReporteMovimientosView exclusivamente al dueño en Reportes", () => {
    const route = navigationTree.find(
      (node) => node.id === "reporte-movimientos",
    );
    expect(route).toMatchObject({
      viewName: "ReporteMovimientosView",
      label: "Movimientos",
      path: "/app/reportes/movimientos-inventario",
      roles: ["dueno"],
      group: "reportes",
      showInMenu: true,
      controllerIds: ["access-control", "movement-report", "audit"],
    });

    expect(
      evaluateRouteAccess("/app/reportes/movimientos-inventario", {
        isAuthenticated: true,
        role: "dueno",
      }),
    ).toEqual({ status: "allow" });

    expect(
      evaluateRouteAccess("/app/reportes/movimientos-inventario", {
        isAuthenticated: true,
        role: "trabajador",
      }),
    ).toMatchObject({
      status: "deny",
      to: APP_HOME_PATH,
    });

    expect(getVisibleMenu("dueno").map((node) => node.id)).toContain(
      "reporte-movimientos",
    );
    expect(getVisibleMenu("trabajador").map((node) => node.id)).not.toContain(
      "reporte-movimientos",
    );
  });
});
