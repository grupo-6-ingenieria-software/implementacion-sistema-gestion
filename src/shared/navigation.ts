export type Role = "dueno" | "trabajador";

export type NavGroup =
  | "publico"
  | "inicio"
  | "inventario"
  | "proveedores"
  | "ventas"
  | "caja"
  | "personal"
  | "administracion";

export type ControllerId =
  | "auth-login"
  | "password"
  | "access-control"
  | "audit"
  | "session"
  | "user-management"
  | "dashboard"
  | "stock-alert"
  | "expiration-alert"
  | "daily-sales-total"
  | "product-create"
  | "product-edit"
  | "product-status"
  | "product-query"
  | "product-delete"
  | "lot"
  | "waste"
  | "sale"
  | "stock-discount"
  | "sales-history"
  | "cash-closing"
  | "cash-check"
  | "worker"
  | "shift"
  | "attendance"
  | "ean-reader"
  | "sale-annulment"
  | "product-detail"
  | "stock-adjustment"
  | "movement-history"
  | "remuneracion"
  | "configuracion-previsional"
  | "supplier-order"
  | "supplier-order-reception"
  | "supplier-create"
  | "supplier-query"
  | "supplier-edit"
  | "restock-list"
  | "restock-report-export"
  | "inventory-valuation";

export type NavNode = {
  id: string;
  viewName: string;
  label: string;
  path: string;
  roles: readonly Role[];
  group: NavGroup;
  showInMenu: boolean;
  entryFrom: string;
  controllerIds: readonly ControllerId[];
};

export type SessionState = {
  isAuthenticated: boolean;
  role?: Role;
  passwordChangeRequired?: boolean;
};

export type RouteGuardDecision =
  | { status: "allow" }
  | {
      status: "redirect";
      to: string;
      reason:
        | "missing-session"
        | "password-change-required"
        | "already-authenticated";
    }
  | {
      status: "deny";
      to: string;
      reason: "role-denied";
      auditControllerId: "audit";
    };

export const PUBLIC_LOGIN_PATH = "/login";
export const PASSWORD_CHANGE_PATH = "/cambiar-contrasena";
export const APP_HOME_PATH = "/app/inicio";

export const navigationTree = [
  {
    id: "login",
    viewName: "LoginView",
    label: "Login",
    path: PUBLIC_LOGIN_PATH,
    roles: [],
    group: "publico",
    showInMenu: false,
    entryFrom: "Pantalla inicial sin sesion.",
    controllerIds: ["auth-login", "session"],
  },
  {
    id: "password-change",
    viewName: "PasswordChangeView",
    label: "Cambiar contrasena",
    path: PASSWORD_CHANGE_PATH,
    roles: [],
    group: "publico",
    showInMenu: false,
    entryFrom: "Redireccion automatica despues de login temporal.",
    controllerIds: ["password", "session"],
  },
  {
    id: "dashboard",
    viewName: "DashboardView",
    label: "Inicio",
    path: APP_HOME_PATH,
    roles: ["dueno", "trabajador"],
    group: "inicio",
    showInMenu: true,
    entryFrom: "Login correcto o accion Inicio.",
    controllerIds: [
      "access-control",
      "dashboard",
      "stock-alert",
      "expiration-alert",
      "daily-sales-total",
      "attendance",
    ],
  },
  {
    id: "product-list",
    viewName: "ProductListView",
    label: "Productos",
    path: "/app/inventario/productos",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: true,
    entryFrom: "Menu Inventario > Productos.",
    controllerIds: ["access-control", "product-status", "product-query"],
  },
  {
    id: "product-create",
    viewName: "ProductFormView",
    label: "Nuevo producto",
    path: "/app/inventario/productos/nuevo",
    roles: ["dueno"],
    group: "inventario",
    showInMenu: false,
    entryFrom: "Accion Nuevo producto desde Productos.",
    controllerIds: ["access-control", "product-create", "audit", "ean-reader"],
  },
  {
    id: "product-edit",
    viewName: "ProductFormView",
    label: "Editar producto",
    path: "/app/inventario/productos/:ean13/editar",
    roles: ["dueno"],
    group: "inventario",
    showInMenu: false,
    entryFrom: "Accion Editar producto desde Productos.",
    controllerIds: ["access-control", "product-edit", "audit", "ean-reader"],
  },
  {
    id: "product-status",
    viewName: "ProductStatusView",
    label: "Cambiar estado",
    path: "/app/inventario/productos/:ean13/estado",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: false,
    entryFrom: "Accion Cambiar estado desde Productos.",
    controllerIds: [
      "access-control",
      "product-status",
      "product-query",
      "audit",
    ],
  },
  {
    id: "product-delete",
    viewName: "ProductDeleteView",
    label: "Eliminar producto",
    path: "/app/inventario/productos/eliminar",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: false,
    entryFrom: "Accion Eliminar producto desde Productos.",
    controllerIds: [
      "access-control",
      "product-query",
      "product-delete",
      "audit",
      "ean-reader",
    ],
  },
  {
    id: "product-detail",
    viewName: "ProductDetailView",
    label: "Detalle de producto",
    path: "/app/inventario/productos/:ean13/detalle",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: false,
    entryFrom: "Accion Ver detalle desde Productos.",
    controllerIds: ["access-control", "product-detail", "product-query"],
  },
  {
    id: "lot-create",
    viewName: "LotCreateView",
    label: "Registrar lote",
    path: "/app/inventario/lotes/nuevo",
    roles: ["dueno"],
    group: "inventario",
    showInMenu: true,
    entryFrom:
      "Menu Inventario > Registrar lote, o accion contextual desde Productos con ?ean13=.",
    controllerIds: [
      "access-control",
      "product-query",
      "lot",
      "audit",
      "ean-reader",
    ],
  },
  {
    id: "waste-create",
    viewName: "WasteCreateView",
    label: "Registrar merma",
    path: "/app/inventario/mermas/nueva",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: true,
    entryFrom: "Menu Inventario > Registrar merma.",
    controllerIds: [
      "access-control",
      "product-query",
      "waste",
      "audit",
      "ean-reader",
    ],
  },
  {
    id: "stock-adjustment",
    viewName: "StockAdjustmentView",
    label: "Ajuste de inventario",
    path: "/app/inventario/ajustes",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: true,
    entryFrom: "Menu Inventario > Ajuste de inventario.",
    controllerIds: ["access-control", "stock-adjustment", "product-query", "audit"],
  },
  {
    id: "movement-history",
    viewName: "MovementHistoryView",
    label: "Movimientos",
    path: "/app/inventario/movimientos",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: true,
    entryFrom: "Menu Inventario > Movimientos, o desde Detalle de producto.",
    controllerIds: ["access-control", "movement-history"],
  },
  {
    id: "restock-list",
    viewName: "RestockListView",
    label: "Lista de reabastecimiento",
    path: "/app/inventario/reabastecimiento",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: true,
    entryFrom: "Menu Inventario > Lista de reabastecimiento.",
    controllerIds: [
      "access-control",
      "restock-list",
      "restock-report-export",
    ],
  },
  {
    id: "inventory-valuation",
    viewName: "ValorizacionInventarioView",
    label: "Valor de inventario",
    path: "/app/inventario/valorizacion",
    roles: ["dueno", "trabajador"],
    group: "inventario",
    showInMenu: true,
    entryFrom: "Menu Inventario > Valor de inventario.",
    controllerIds: ["access-control", "inventory-valuation"],
  },
  {
    id: "supplier-list",
    viewName: "SupplierListView",
    label: "Listado de proveedores",
    path: "/app/proveedores/listado",
    roles: ["dueno", "trabajador"],
    group: "proveedores",
    showInMenu: true,
    entryFrom: "Menu Proveedores > Listado de proveedores.",
    controllerIds: ["access-control", "supplier-query"],
  },
  {
    id: "supplier-create",
    viewName: "SupplierFormView",
    label: "Registrar proveedor",
    path: "/app/proveedores/nuevo",
    roles: ["dueno", "trabajador"],
    group: "proveedores",
    showInMenu: false,
    entryFrom: "Accion Registrar proveedor desde Listado de proveedores.",
    controllerIds: ["access-control", "supplier-create", "audit"],
  },
  {
    id: "supplier-edit",
    viewName: "SupplierFormView",
    label: "Editar proveedor",
    path: "/app/proveedores/:rut/editar",
    roles: ["dueno", "trabajador"],
    group: "proveedores",
    showInMenu: false,
    entryFrom: "Accion Editar desde Listado de proveedores.",
    controllerIds: [
      "access-control",
      "supplier-create",
      "supplier-query",
      "supplier-edit",
      "audit",
    ],
  },
  {
    id: "supplier-order-create",
    viewName: "RegistrarPedidoProveedorView",
    label: "Registrar pedido",
    path: "/app/proveedores/pedidos/nuevo",
    roles: ["dueno", "trabajador"],
    group: "proveedores",
    showInMenu: true,
    entryFrom: "Menu Proveedores > Registrar pedido.",
    controllerIds: [
      "access-control",
      "supplier-order",
      "lot",
      "product-query",
      "audit",
      "ean-reader",
    ],
  },
  {
    id: "supplier-order-receptions",
    viewName: "ConfirmarRecepcionPedidoView",
    label: "Recepciones e historial de pedidos",
    path: "/app/proveedores/pedidos",
    roles: ["dueno", "trabajador"],
    group: "proveedores",
    showInMenu: true,
    entryFrom: "Menu Proveedores > Recepciones e historial de pedidos.",
    controllerIds: [
      "access-control",
      "supplier-order-reception",
      "audit",
    ],
  },
  {
    id: "sale-register",
    viewName: "SaleRegisterView",
    label: "Registrar venta",
    path: "/app/ventas/registrar",
    roles: ["dueno", "trabajador"],
    group: "ventas",
    showInMenu: true,
    entryFrom: "Menu Ventas > Registrar venta.",
    controllerIds: [
      "access-control",
      "sale",
      "stock-discount",
      "cash-check",
      "audit",
      "ean-reader",
    ],
  },
  {
    id: "daily-sales",
    viewName: "DailySalesView",
    label: "Ventas del dia",
    path: "/app/ventas/dia",
    roles: ["dueno", "trabajador"],
    group: "ventas",
    showInMenu: true,
    entryFrom: "Menu Ventas > Ventas del dia.",
    controllerIds: ["access-control", "sales-history"],
  },
  {
    id: "sales-query",
    viewName: "ConsultaVentasView",
    label: "Consulta de ventas",
    path: "/app/ventas/consulta",
    roles: ["dueno", "trabajador"],
    group: "ventas",
    showInMenu: true,
    entryFrom: "Menu Ventas > Consulta de ventas.",
    controllerIds: ["access-control", "sales-history"],
  },
  {
    id: "sale-annulment",
    viewName: "AnularVentaView",
    label: "Anular venta",
    path: "/app/ventas/anular",
    roles: ["dueno", "trabajador"],
    group: "ventas",
    showInMenu: true,
    entryFrom: "Menu Ventas, Ventas del dia o Consulta de ventas.",
    controllerIds: [
      "access-control",
      "sales-history",
      "sale-annulment",
      "audit",
    ],
  },
  {
    id: "cash-closing",
    viewName: "CashClosingView",
    label: "Cierre de caja",
    path: "/app/caja/cierre",
    roles: ["dueno", "trabajador"],
    group: "caja",
    showInMenu: true,
    entryFrom: "Menu Caja > Cierre de caja.",
    controllerIds: ["access-control", "cash-closing", "cash-check", "audit"],
  },
  {
    id: "worker-list",
    viewName: "WorkerListView",
    label: "Trabajadores",
    path: "/app/personal/trabajadores",
    roles: ["dueno", "trabajador"],
    group: "personal",
    showInMenu: true,
    entryFrom: "Menu Personal > Trabajadores.",
    controllerIds: ["access-control", "worker", "audit"],
  },
  {
    id: "worker-create",
    viewName: "WorkerFormView",
    label: "Registrar trabajador",
    path: "/app/personal/trabajadores/nuevo",
    roles: ["dueno"],
    group: "personal",
    showInMenu: false,
    entryFrom: "Accion Registrar trabajador desde Trabajadores.",
    controllerIds: ["access-control", "worker", "audit"],
  },
  {
    id: "shift-calendar",
    viewName: "ShiftCalendarView",
    label: "Turnos",
    path: "/app/personal/turnos",
    roles: ["dueno", "trabajador"],
    group: "personal",
    showInMenu: true,
    entryFrom: "Menu Personal > Turnos.",
    controllerIds: ["access-control", "shift"],
  },
  {
    id: "shift-create",
    viewName: "ShiftCreateView",
    label: "Crear turno",
    path: "/app/personal/turnos/nuevo",
    roles: ["dueno"],
    group: "personal",
    showInMenu: false,
    entryFrom: "Accion Crear turno desde Turnos.",
    controllerIds: ["access-control", "shift", "audit"],
  },
  {
    id: "shift-edit",
    viewName: "ShiftCreateView",
    label: "Editar turno",
    path: "/app/personal/turnos/:id/editar",
    roles: ["dueno"],
    group: "personal",
    showInMenu: false,
    entryFrom: "Accion Editar turno desde Turnos (V18).",
    controllerIds: ["access-control", "shift", "audit"],
  },
  {
    id: "attendance",
    viewName: "AttendanceView",
    label: "Asistencia",
    path: "/app/personal/asistencia",
    roles: ["dueno", "trabajador"],
    group: "personal",
    showInMenu: true,
    entryFrom: "Menu Personal > Asistencia.",
    controllerIds: ["access-control", "attendance", "audit"],
  },
  {
    id: "remuneracion-create",
    viewName: "RegistrarRemuneracionView",
    label: "Remuneraciones",
    path: "/app/personal/remuneraciones/nueva",
    roles: ["dueno"],
    group: "personal",
    showInMenu: true,
    entryFrom: "Menu Personal > Remuneraciones > Registrar.",
    controllerIds: [
      "access-control",
      "remuneracion",
      "configuracion-previsional",
      "audit",
    ],
  },
  {
    id: "configuracion-previsional",
    viewName: "ConfigurarPorcentajesPrevisionalesView",
    label: "Configuracion previsional",
    path: "/app/personal/configuracion-previsional",
    roles: ["dueno"],
    group: "personal",
    showInMenu: true,
    entryFrom: "Menu Personal > Configuracion previsional.",
    controllerIds: ["access-control", "configuracion-previsional", "audit"],
  },
  {
    id: "user-management",
    viewName: "UserManagementView",
    label: "Usuarios",
    path: "/app/admin/usuarios",
    roles: ["dueno"],
    group: "administracion",
    showInMenu: true,
    entryFrom: "Menu Administracion > Usuarios.",
    controllerIds: ["access-control", "user-management", "audit"],
  },
  {
    id: "audit-log",
    viewName: "AuditLogView",
    label: "Log de auditoria",
    path: "/app/admin/auditoria",
    roles: ["dueno"],
    group: "administracion",
    showInMenu: true,
    entryFrom: "Menu Administracion > Log de auditoria.",
    controllerIds: ["access-control", "audit"],
  },
] as const satisfies readonly NavNode[];

export const internalComponents = [
  {
    id: "sale-discount-modal",
    name: "DescuentoVentaModal",
    usedIn: ["sale-register"],
    controllerIds: ["sale"],
  },
  {
    id: "ean-input",
    name: "CampoEAN13Input",
    usedIn: [
      "product-list",
      "product-create",
      "product-delete",
      "lot-create",
      "waste-create",
      "sale-register",
      "supplier-order-create",
    ],
    controllerIds: ["ean-reader"],
  },
  {
    id: "daily-sales-summary",
    name: "ResumenVentasDashboard",
    usedIn: ["dashboard"],
    controllerIds: ["daily-sales-total"],
  },
  {
    id: "sale-payment-sections",
    name: "SeccionesPagoVenta",
    usedIn: ["sale-register"],
    controllerIds: ["sale"],
  },
  {
    id: "restock-print-view",
    name: "ListaReabastecimientoPrintView",
    usedIn: ["restock-list"],
    controllerIds: ["restock-report-export"],
  },
] as const;

export const appMenuGroups: readonly NavGroup[] = [
  "inicio",
  "inventario",
  "proveedores",
  "ventas",
  "caja",
  "personal",
  "administracion",
];

export const navGroupLabels: Record<NavGroup, string> = {
  publico: "Publico",
  inicio: "Inicio",
  inventario: "Inventario",
  proveedores: "Proveedores",
  ventas: "Ventas",
  caja: "Caja",
  personal: "Personal",
  administracion: "Administracion",
};

export function getVisibleMenu(role: Role): NavNode[] {
  return navigationTree.filter(
    (node) => node.showInMenu && (node.roles as readonly Role[]).includes(role),
  );
}

export function getVisibleGroups(role: Role): NavGroup[] {
  const visibleNodes = getVisibleMenu(role);
  return appMenuGroups.filter((group) =>
    visibleNodes.some((node) => node.group === group),
  );
}

export function findNavNodeByPath(pathname: string): NavNode | undefined {
  return navigationTree.find((node) => pathMatches(node.path, pathname));
}

export function resolveInitialRoute(session: SessionState): string {
  if (!session.isAuthenticated) {
    return PUBLIC_LOGIN_PATH;
  }

  if (session.passwordChangeRequired) {
    return PASSWORD_CHANGE_PATH;
  }

  return APP_HOME_PATH;
}

export function evaluateRouteAccess(
  pathname: string,
  session: SessionState,
): RouteGuardDecision {
  const node = findNavNodeByPath(pathname);

  if (
    pathname === PUBLIC_LOGIN_PATH &&
    session.isAuthenticated &&
    !session.passwordChangeRequired
  ) {
    return {
      status: "redirect",
      to: APP_HOME_PATH,
      reason: "already-authenticated",
    };
  }

  if (!pathname.startsWith("/app")) {
    if (
      pathname === PASSWORD_CHANGE_PATH &&
      session.isAuthenticated &&
      session.passwordChangeRequired
    ) {
      return { status: "allow" };
    }

    if (pathname === PUBLIC_LOGIN_PATH && !session.isAuthenticated) {
      return { status: "allow" };
    }

    return {
      status: "redirect",
      to: resolveInitialRoute(session),
      reason: "missing-session",
    };
  }

  if (!session.isAuthenticated || !session.role) {
    return {
      status: "redirect",
      to: PUBLIC_LOGIN_PATH,
      reason: "missing-session",
    };
  }

  if (session.passwordChangeRequired) {
    return {
      status: "redirect",
      to: PASSWORD_CHANGE_PATH,
      reason: "password-change-required",
    };
  }

  if (!node || !(node.roles as readonly Role[]).includes(session.role)) {
    return {
      status: "deny",
      to: APP_HOME_PATH,
      reason: "role-denied",
      auditControllerId: "audit",
    };
  }

  return { status: "allow" };
}

export function validateNavigationTree(): string[] {
  const errors: string[] = [];
  const paths = new Set<string>();
  const requiredRouteIds = new Set([
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
    "product-detail",
    "stock-adjustment",
    "movement-history",
    "restock-list",
    "inventory-valuation",
    "supplier-list",
    "supplier-create",
    "supplier-edit",
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
    "shift-edit",
    "attendance",
    "remuneracion-create",
    "configuracion-previsional",
    "user-management",
    "audit-log",
  ]);

  for (const node of navigationTree) {
    if (paths.has(node.path)) {
      errors.push(`Ruta duplicada: ${node.path}`);
    }
    paths.add(node.path);
    requiredRouteIds.delete(node.id);

    if (node.path.startsWith("/app") && node.roles.length === 0) {
      errors.push(`Ruta privada sin roles: ${node.path}`);
    }
  }

  for (const routeId of requiredRouteIds) {
    errors.push(`Ruta sin declaracion: ${routeId}`);
  }

  for (const component of internalComponents) {
    if (navigationTree.some((node) => node.id === (component.id as string))) {
      errors.push(`Componente interno declarado como ruta: ${component.id}`);
    }
  }

  return errors;
}

function pathMatches(pattern: string, pathname: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPathname = normalizePath(pathname);

  if (!normalizedPattern.includes(":")) {
    return normalizedPattern === normalizedPathname;
  }

  const patternParts = normalizedPattern.split("/");
  const pathnameParts = normalizedPathname.split("/");

  if (patternParts.length !== pathnameParts.length) {
    return false;
  }

  return patternParts.every(
    (part, index) => part.startsWith(":") || part === pathnameParts[index],
  );
}

function normalizePath(path: string): string {
  const [pathname] = path.split("?");
  return pathname.replace(/\/+$/, "") || "/";
}
