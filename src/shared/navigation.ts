export type Role = 'dueno' | 'trabajador';

export type NavGroup =
  | 'publico'
  | 'inicio'
  | 'inventario'
  | 'ventas'
  | 'caja'
  | 'personal'
  | 'administracion';

export type ControllerId =
  | 'auth-login'
  | 'password'
  | 'access-control'
  | 'audit'
  | 'session'
  | 'user-management'
  | 'dashboard'
  | 'stock-alert'
  | 'expiration-alert'
  | 'daily-sales-total'
  | 'product-create'
  | 'product-edit'
  | 'product-status'
  | 'product-query'
  | 'lot'
  | 'waste'
  | 'sale'
  | 'stock-discount'
  | 'sales-history'
  | 'cash-closing'
  | 'cash-check'
  | 'worker'
  | 'shift'
  | 'attendance'
  | 'ean-reader';

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
  | { status: 'allow' }
  | {
      status: 'redirect';
      to: string;
      reason:
        | 'missing-session'
        | 'password-change-required'
        | 'already-authenticated';
    }
  | {
      status: 'deny';
      to: string;
      reason: 'role-denied';
      auditControllerId: 'audit';
    };

export const PUBLIC_LOGIN_PATH = '/login';
export const PASSWORD_CHANGE_PATH = '/cambiar-contrasena';
export const APP_HOME_PATH = '/app/inicio';

export const navigationTree = [
  {
    id: 'login',
    viewName: 'LoginView',
    label: 'Login',
    path: PUBLIC_LOGIN_PATH,
    roles: [],
    group: 'publico',
    showInMenu: false,
    entryFrom: 'Pantalla inicial sin sesion.',
    controllerIds: ['auth-login', 'session'],
  },
  {
    id: 'password-change',
    viewName: 'PasswordChangeView',
    label: 'Cambiar contrasena',
    path: PASSWORD_CHANGE_PATH,
    roles: [],
    group: 'publico',
    showInMenu: false,
    entryFrom: 'Redireccion automatica despues de login temporal.',
    controllerIds: ['password', 'session'],
  },
  {
    id: 'dashboard',
    viewName: 'DashboardView',
    label: 'Inicio',
    path: APP_HOME_PATH,
    roles: ['dueno', 'trabajador'],
    group: 'inicio',
    showInMenu: true,
    entryFrom: 'Login correcto o accion Inicio.',
    controllerIds: [
      'access-control',
      'dashboard',
      'stock-alert',
      'expiration-alert',
      'daily-sales-total',
      'attendance',
    ],
  },
  {
    id: 'product-list',
    viewName: 'ProductListView',
    label: 'Productos',
    path: '/app/inventario/productos',
    roles: ['dueno', 'trabajador'],
    group: 'inventario',
    showInMenu: true,
    entryFrom: 'Menu Inventario > Productos.',
    controllerIds: ['access-control', 'product-status', 'product-query'],
  },
  {
    id: 'product-create',
    viewName: 'ProductFormView',
    label: 'Nuevo producto',
    path: '/app/inventario/productos/nuevo',
    roles: ['dueno'],
    group: 'inventario',
    showInMenu: false,
    entryFrom: 'Accion Nuevo producto desde Productos.',
    controllerIds: ['access-control', 'product-create', 'audit', 'ean-reader'],
  },
  {
    id: 'product-edit',
    viewName: 'ProductFormView',
    label: 'Editar producto',
    path: '/app/inventario/productos/:ean13/editar',
    roles: ['dueno'],
    group: 'inventario',
    showInMenu: false,
    entryFrom: 'Accion Editar producto desde Productos.',
    controllerIds: ['access-control', 'product-edit', 'audit', 'ean-reader'],
  },
  {
    id: 'product-status',
    viewName: 'ProductStatusView',
    label: 'Cambiar estado',
    path: '/app/inventario/productos/:ean13/estado',
    roles: ['dueno', 'trabajador'],
    group: 'inventario',
    showInMenu: false,
    entryFrom: 'Accion Cambiar estado desde Productos.',
    controllerIds: [
      'access-control',
      'product-status',
      'product-query',
      'audit',
    ],
  },
  {
    id: 'lot-create',
    viewName: 'LotCreateView',
    label: 'Registrar lote',
    path: '/app/inventario/lotes/nuevo',
    roles: ['dueno'],
    group: 'inventario',
    showInMenu: true,
    entryFrom: 'Menu Inventario > Registrar lote.',
    controllerIds: [
      'access-control',
      'product-query',
      'lot',
      'audit',
      'ean-reader',
    ],
  },
  {
    id: 'waste-create',
    viewName: 'WasteCreateView',
    label: 'Registrar merma',
    path: '/app/inventario/mermas/nueva',
    roles: ['dueno', 'trabajador'],
    group: 'inventario',
    showInMenu: true,
    entryFrom: 'Menu Inventario > Registrar merma.',
    controllerIds: [
      'access-control',
      'product-query',
      'waste',
      'audit',
      'ean-reader',
    ],
  },
  {
    id: 'sale-register',
    viewName: 'SaleRegisterView',
    label: 'Registrar venta',
    path: '/app/ventas/registrar',
    roles: ['dueno', 'trabajador'],
    group: 'ventas',
    showInMenu: true,
    entryFrom: 'Menu Ventas > Registrar venta.',
    controllerIds: [
      'access-control',
      'sale',
      'stock-discount',
      'cash-check',
      'audit',
      'ean-reader',
    ],
  },
  {
    id: 'daily-sales',
    viewName: 'DailySalesView',
    label: 'Ventas del dia',
    path: '/app/ventas/dia',
    roles: ['dueno', 'trabajador'],
    group: 'ventas',
    showInMenu: true,
    entryFrom: 'Menu Ventas > Ventas del dia.',
    controllerIds: ['access-control', 'sales-history'],
  },
  {
    id: 'cash-closing',
    viewName: 'CashClosingView',
    label: 'Cierre de caja',
    path: '/app/caja/cierre',
    roles: ['dueno', 'trabajador'],
    group: 'caja',
    showInMenu: true,
    entryFrom: 'Menu Caja > Cierre de caja.',
    controllerIds: ['access-control', 'cash-closing', 'cash-check', 'audit'],
  },
  {
    id: 'worker-list',
    viewName: 'WorkerListView',
    label: 'Trabajadores',
    path: '/app/personal/trabajadores',
    roles: ['dueno'],
    group: 'personal',
    showInMenu: true,
    entryFrom: 'Menu Personal > Trabajadores.',
    controllerIds: ['access-control', 'worker', 'audit'],
  },
  {
    id: 'worker-create',
    viewName: 'WorkerFormView',
    label: 'Registrar trabajador',
    path: '/app/personal/trabajadores/nuevo',
    roles: ['dueno'],
    group: 'personal',
    showInMenu: false,
    entryFrom: 'Accion Registrar trabajador desde Trabajadores.',
    controllerIds: ['access-control', 'worker', 'audit'],
  },
  {
    id: 'shift-calendar',
    viewName: 'ShiftCalendarView',
    label: 'Turnos',
    path: '/app/personal/turnos',
    roles: ['dueno'],
    group: 'personal',
    showInMenu: true,
    entryFrom: 'Menu Personal > Turnos.',
    controllerIds: ['access-control', 'shift'],
  },
  {
    id: 'shift-create',
    viewName: 'ShiftCreateView',
    label: 'Crear turno',
    path: '/app/personal/turnos/nuevo',
    roles: ['dueno'],
    group: 'personal',
    showInMenu: false,
    entryFrom: 'Accion Crear turno desde Turnos.',
    controllerIds: ['access-control', 'shift', 'audit'],
  },
  {
    id: 'attendance',
    viewName: 'AttendanceView',
    label: 'Asistencia',
    path: '/app/personal/asistencia',
    roles: ['dueno', 'trabajador'],
    group: 'personal',
    showInMenu: true,
    entryFrom: 'Menu Personal > Asistencia.',
    controllerIds: ['access-control', 'attendance', 'audit'],
  },
  {
    id: 'user-management',
    viewName: 'UserManagementView',
    label: 'Usuarios',
    path: '/app/admin/usuarios',
    roles: ['dueno'],
    group: 'administracion',
    showInMenu: true,
    entryFrom: 'Menu Administracion > Usuarios.',
    controllerIds: ['access-control', 'user-management', 'audit'],
  },
  {
    id: 'audit-log',
    viewName: 'AuditLogView',
    label: 'Log de auditoria',
    path: '/app/admin/auditoria',
    roles: ['dueno'],
    group: 'administracion',
    showInMenu: true,
    entryFrom: 'Menu Administracion > Log de auditoria.',
    controllerIds: ['access-control', 'audit'],
  },
] as const satisfies readonly NavNode[];

export const internalComponents = [
  {
    id: 'ean-input',
    name: 'CampoEAN13Input',
    usedIn: [
      'product-list',
      'product-create',
      'lot-create',
      'waste-create',
      'sale-register',
    ],
    controllerIds: ['ean-reader'],
  },
  {
    id: 'daily-sales-summary',
    name: 'ResumenVentasDashboard',
    usedIn: ['dashboard'],
    controllerIds: ['daily-sales-total'],
  },
  {
    id: 'sale-payment-sections',
    name: 'SeccionesPagoVenta',
    usedIn: ['sale-register'],
    controllerIds: ['sale'],
  },
] as const;

export const appMenuGroups: readonly NavGroup[] = [
  'inicio',
  'inventario',
  'ventas',
  'caja',
  'personal',
  'administracion',
];

export const navGroupLabels: Record<NavGroup, string> = {
  publico: 'Publico',
  inicio: 'Inicio',
  inventario: 'Inventario',
  ventas: 'Ventas',
  caja: 'Caja',
  personal: 'Personal',
  administracion: 'Administracion',
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
      status: 'redirect',
      to: APP_HOME_PATH,
      reason: 'already-authenticated',
    };
  }

  if (!pathname.startsWith('/app')) {
    if (
      pathname === PASSWORD_CHANGE_PATH &&
      session.isAuthenticated &&
      session.passwordChangeRequired
    ) {
      return { status: 'allow' };
    }

    if (pathname === PUBLIC_LOGIN_PATH && !session.isAuthenticated) {
      return { status: 'allow' };
    }

    return {
      status: 'redirect',
      to: resolveInitialRoute(session),
      reason: 'missing-session',
    };
  }

  if (!session.isAuthenticated || !session.role) {
    return {
      status: 'redirect',
      to: PUBLIC_LOGIN_PATH,
      reason: 'missing-session',
    };
  }

  if (session.passwordChangeRequired) {
    return {
      status: 'redirect',
      to: PASSWORD_CHANGE_PATH,
      reason: 'password-change-required',
    };
  }

  if (!node || !(node.roles as readonly Role[]).includes(session.role)) {
    return {
      status: 'deny',
      to: APP_HOME_PATH,
      reason: 'role-denied',
      auditControllerId: 'audit',
    };
  }

  return { status: 'allow' };
}

export function validateNavigationTree(): string[] {
  const errors: string[] = [];
  const paths = new Set<string>();
  const requiredRouteIds = new Set([
    'login',
    'password-change',
    'dashboard',
    'product-list',
    'product-create',
    'product-edit',
    'product-status',
    'lot-create',
    'waste-create',
    'sale-register',
    'daily-sales',
    'cash-closing',
    'worker-list',
    'worker-create',
    'shift-calendar',
    'shift-create',
    'attendance',
    'user-management',
    'audit-log',
  ]);

  for (const node of navigationTree) {
    if (paths.has(node.path)) {
      errors.push(`Ruta duplicada: ${node.path}`);
    }
    paths.add(node.path);
    requiredRouteIds.delete(node.id);

    if (node.path.startsWith('/app') && node.roles.length === 0) {
      errors.push(`Ruta privada sin roles: ${node.path}`);
    }
  }

  for (const routeId of requiredRouteIds) {
    errors.push(`Ruta sin declaracion: ${routeId}`);
  }

  for (const component of internalComponents) {
    if (
      navigationTree.some((node) => node.id === (component.id as string))
    ) {
      errors.push(`Componente interno declarado como ruta: ${component.id}`);
    }
  }

  return errors;
}

function pathMatches(pattern: string, pathname: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPathname = normalizePath(pathname);

  if (!normalizedPattern.includes(':')) {
    return normalizedPattern === normalizedPathname;
  }

  const patternParts = normalizedPattern.split('/');
  const pathnameParts = normalizedPathname.split('/');

  if (patternParts.length !== pathnameParts.length) {
    return false;
  }

  return patternParts.every(
    (part, index) => part.startsWith(':') || part === pathnameParts[index],
  );
}

function normalizePath(path: string): string {
  const [pathname] = path.split('?');
  return pathname.replace(/\/+$/, '') || '/';
}
