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

describe("navigation tree", () => {
  it("declares every route without structural errors", () => {
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
        "supplier-order-create",
        "supplier-order-receptions",
        "sale-register",
        "daily-sales",
        "sales-query",
        "sale-annulment",
        "cash-closing",
        "worker-list",
        "worker-create",
        "shift-calendar",
        "shift-create",
        "attendance",
        "remuneracion-create",
        "configuracion-previsional",
        "user-management",
        "audit-log",
        "product-detail",
        "stock-adjustment",
        "movement-history",
      ]),
    );
  });

  it("keeps internal UI components outside routes and menus", () => {
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

  it("filters menu groups by role", () => {
    expect(getVisibleGroups("dueno")).toEqual([
      "inicio",
      "inventario",
      "proveedores",
      "ventas",
      "caja",
      "personal",
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

  it("guards session, password change and role access", () => {
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

  it("allows both supported roles to access daily sales", () => {
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

  it("exposes CU38 to both roles from the sales menu", () => {
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

  it("exposes CU41 to both roles from the sales menu", () => {
    const node = navigationTree.find((item) => item.id === "sales-query");
    expect(node).toMatchObject({
      path: "/app/ventas/consulta",
      showInMenu: true,
      roles: ["dueno", "trabajador"],
      controllerIds: ["access-control", "sales-history"],
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

  it("allows both roles to access product deletion outside the menu", () => {
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

  it("allows only the owner to access V16 and V17", () => {
    for (const path of ["/app/personal/turnos", "/app/personal/turnos/nuevo"]) {
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

  it("allows only the owner to access V30 and V31", () => {
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
});
