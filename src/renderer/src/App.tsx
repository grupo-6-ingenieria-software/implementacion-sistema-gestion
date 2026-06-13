import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type UIEventHandler,
} from 'react';
import {
  APP_HOME_PATH,
  PASSWORD_CHANGE_PATH,
  PUBLIC_LOGIN_PATH,
  appMenuGroups,
  evaluateRouteAccess,
  findNavNodeByPath,
  getVisibleMenu,
  internalComponents,
  navGroupLabels,
  navigationTree,
  resolveInitialRoute,
  type NavNode,
  type Role,
  type RouteGuardDecision,
  type SessionState,
} from '../../shared/navigation';
import { findControllerById } from '../../shared/controllers';
import type { ControllerMetadata } from '../../shared/controllers';
import { AuditLogView } from './views/AuditLogView';
import { DashboardView } from './views/DashboardView';
import { AttendanceView } from './views/AttendanceView';
import { CashClosingView } from './views/CashClosingView';
import { LotCreateView } from './views/LotCreateView';
import { ProductFormView } from './views/ProductFormView';
import { ProductListView } from './views/ProductListView';
import { ProductStatusView } from './views/ProductStatusView';
import { SaleRegisterView } from './views/SaleRegisterView';
import { WasteCreateView } from './views/WasteCreateView';

type AppSession = SessionState & {
  displayName?: string;
  usuarioId?: string;
  trabajadorNombre?: string;
  usuarioRol?: string;
};

const defaultSession: AppSession = {
  isAuthenticated: false,
};

type DevLoginData = {
  role: Role;
  usuarioId: string;
  trabajadorNombre: string;
  usuarioRol: string;
};

export function App(): ReactElement {
  const [session, setSession] = useState<AppSession>(defaultSession);
  const [path, setPath] = useState(getHashPath);
  const lastRouteAuditKey = useRef<string | null>(null);

  useEffect(() => {
    const handleHashChange = (): void => setPath(getHashPath());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const decision = evaluateRouteAccess(path, session);

    auditRouteAccess(path, session, decision, lastRouteAuditKey);

    if (decision.status !== 'allow') {
      navigate(decision.to);
    }
  }, [path, session]);

  const login = (
    role: Role,
    passwordChangeRequired = false,
    loginData?: DevLoginData,
  ): void => {
    const nextSession = {
      isAuthenticated: true,
      role,
      passwordChangeRequired,
      displayName:
        loginData?.trabajadorNombre ??
        (role === 'dueno' ? 'Dueno' : 'Trabajador'),
      usuarioId: loginData?.usuarioId,
      trabajadorNombre: loginData?.trabajadorNombre,
      usuarioRol: loginData?.usuarioRol,
    };

    setSession(nextSession);
    navigate(resolveInitialRoute(nextSession));
  };

  const logout = (): void => {
    setSession(defaultSession);
    navigate(PUBLIC_LOGIN_PATH);
  };

  const completePasswordChange = (): void => {
    const nextSession = {
      ...session,
      passwordChangeRequired: false,
    };
    setSession(nextSession);
    navigate(APP_HOME_PATH);
  };

  if (path === PUBLIC_LOGIN_PATH) {
    return <LoginView onLogin={login} />;
  }

  if (path === PASSWORD_CHANGE_PATH) {
    return (
      <PasswordChangeView
        onComplete={completePasswordChange}
        onLogout={logout}
      />
    );
  }

  return (
    <AppShell
      currentPath={path}
      session={session}
      onNavigate={navigate}
      onLogout={logout}
    />
  );
}

function LoginView({
  onLogin,
}: {
  onLogin: (
    role: Role,
    passwordChangeRequired?: boolean,
    loginData?: DevLoginData,
  ) => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<Role | null>(null);

  const handleLogin = async (
    role: Role,
    passwordChangeRequired = false,
  ): Promise<void> => {
    setError(null);
    setIsLoading(role);

    const response = await window.appApi.invoke<DevLoginData>('auth:login', {
      role,
    });

    setIsLoading(null);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    onLogin(response.data.role, passwordChangeRequired, response.data);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf1f5] px-6">
      <section className="w-full max-w-[420px] rounded-md border border-[#c8d2dc] bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-[#2d6a4f]">Login</p>
        <h1 className="mt-3 text-2xl font-semibold text-[#17202a]">
          Sistema de Gestion Huascar
        </h1>
        <div className="mt-8 grid gap-3">
          <button
            className="rounded-md bg-[#244d61] px-4 py-3 text-left font-semibold text-white transition hover:bg-[#1f4354]"
            disabled={Boolean(isLoading)}
            type="button"
            onClick={() => void handleLogin('dueno')}
          >
            {isLoading === 'dueno' ? 'Entrando...' : 'Entrar como dueno'}
          </button>
          <button
            className="rounded-md bg-[#2d6a4f] px-4 py-3 text-left font-semibold text-white transition hover:bg-[#255a43]"
            disabled={Boolean(isLoading)}
            type="button"
            onClick={() => void handleLogin('trabajador')}
          >
            {isLoading === 'trabajador'
              ? 'Entrando...'
              : 'Entrar como trabajador'}
          </button>
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-3 text-left font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            disabled={Boolean(isLoading)}
            type="button"
            onClick={() => void handleLogin('trabajador', true)}
          >
            Entrar con cambio de contrasena
          </button>
          {error ? (
            <p className="rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-sm font-medium text-[#b42318]">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function PasswordChangeView({
  onComplete,
  onLogout,
}: {
  onComplete: () => void;
  onLogout: () => void;
}): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf1f5] px-6">
      <section className="w-full max-w-[460px] rounded-md border border-[#c8d2dc] bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-[#8a5a12]">
          Cambio obligatorio
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-[#17202a]">
          Cambio obligatorio de contrasena
        </h1>
        <div className="mt-8 grid gap-3">
          <button
            className="rounded-md bg-[#244d61] px-4 py-3 text-left font-semibold text-white transition hover:bg-[#1f4354]"
            type="button"
            onClick={onComplete}
          >
            Continuar a inicio
          </button>
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-3 text-left font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={onLogout}
          >
            Cerrar sesion
          </button>
        </div>
      </section>
    </main>
  );
}

function AppShell({
  currentPath,
  session,
  onNavigate,
  onLogout,
}: {
  currentPath: string;
  session: AppSession;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): ReactElement {
  const visibleMenu = useMemo(
    () => (session.role ? getVisibleMenu(session.role) : []),
    [session.role],
  );
  const currentNode = findNavNodeByPath(currentPath) ?? navigationTree[2];
  const isProductScreen =
    currentNode.id === 'product-list' ||
    currentNode.id === 'product-create' ||
    currentNode.id === 'product-edit' ||
    currentNode.id === 'product-status';
  const sidebarScroll = useAutoHiddenScrollbar();
  const mainScroll = useAutoHiddenScrollbar();

  return (
    <div className="grid h-screen grid-cols-[280px_1fr] overflow-hidden bg-[#f6f7f9] text-[#17202a]">
      <aside
        className={`scroll-area h-screen overflow-y-auto border-r border-[#cbd5df] bg-[#17202a] text-white ${sidebarScroll.className}`}
        onScroll={sidebarScroll.onScroll}
      >
        <div className="border-b border-white/10 px-5 py-5">
          <p className="text-xs font-semibold uppercase text-[#9dd6bd]">
            Minimarket y Panaderia
          </p>
          <h1 className="mt-2 text-xl font-semibold">Huascar</h1>
        </div>
        <nav className="px-3 py-4">
          {appMenuGroups.map((group) => {
            const nodes = visibleMenu.filter((node) => node.group === group);

            if (nodes.length === 0) {
              return null;
            }

            return (
              <div className="mb-5" key={group}>
                <p className="px-2 text-xs font-semibold uppercase text-[#9ba9b5]">
                  {navGroupLabels[group]}
                </p>
                <div className="mt-2 grid gap-1">
                  {nodes.map((node) => (
                    <button
                      className={`rounded-md px-3 py-2 text-left text-sm transition ${
                        currentNode.id === node.id
                          ? 'bg-[#2d6a4f] text-white'
                          : 'text-[#dbe3ea] hover:bg-white/10'
                      }`}
                      key={node.id}
                      type="button"
                      onClick={() => onNavigate(node.path)}
                    >
                      {node.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
      <main
        className={`scroll-area min-w-0 overflow-y-auto ${mainScroll.className}`}
        onScroll={mainScroll.onScroll}
      >
        <header className="flex items-center justify-between border-b border-[#cbd5df] bg-white px-8 py-4">
          <div>
            <p className="text-sm font-semibold text-[#61717f]">
              {isProductScreen ? 'Inventario' : currentNode.path}
            </p>
            <h2 className="mt-1 text-2xl font-semibold">{currentNode.label}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-[#cbd5df] bg-[#f6f7f9] px-3 py-2 text-sm font-semibold text-[#24313d]">
              {session.displayName ?? 'Sesion'}
            </span>
            <button
              className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={onLogout}
            >
              Salir
            </button>
          </div>
        </header>
        <ViewRenderer
          node={currentNode}
          session={session}
          onNavigate={onNavigate}
          currentPath={currentPath}
        />
      </main>
    </div>
  );
}

function useAutoHiddenScrollbar(): {
  className: string;
  onScroll: UIEventHandler<HTMLElement>;
} {
  const [isScrolling, setIsScrolling] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const onScroll: UIEventHandler<HTMLElement> = () => {
    setIsScrolling(true);

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setIsScrolling(false);
      timeoutRef.current = null;
    }, 900);
  };

  return {
    className: isScrolling ? 'is-scrolling' : '',
    onScroll,
  };
}

function ViewRenderer({
  currentPath,
  node,
  onNavigate,
  session,
}: {
  currentPath: string;
  node: NavNode;
  onNavigate: (path: string) => void;
  session: AppSession;
}): ReactElement {
  if (node.id === 'dashboard' && session.role) {
    return (
      <DashboardView
        role={session.role}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  if (node.id === 'lot-create' && session.usuarioId) {
    return (
      <LotCreateView
        initialEan13={getLotCreateEan13(currentPath)}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  if (node.id === 'sale-register') {
    return <SaleRegisterView session={session} />;
  }

  if (node.id === 'waste-create' && session.usuarioId) {
    return (
      <WasteCreateView
        initialEan13={getWasteCreateEan13(currentPath)}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  if (node.id === 'cash-closing') {
    return (
      <CashClosingView
        displayName={session.displayName}
        usuarioId={session.usuarioId}
      />
    );
  }

  if (node.id === 'attendance' && session.role) {
    return <AttendanceView role={session.role} usuarioId={session.usuarioId} />;
  }

  if (node.id === 'product-list' && session.role && session.usuarioId) {
    return (
      <ProductListView
        role={session.role}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  if (
    (node.id === 'product-create' || node.id === 'product-edit') &&
    session.usuarioId
  ) {
    return (
      <ProductFormView
        ean13={getProductEditEan13(currentPath)}
        mode={node.id === 'product-create' ? 'create' : 'edit'}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  if (node.id === 'audit-log') {
    return <AuditLogView usuarioId={session.usuarioId} />;
  }

  if (node.id === 'product-status' && session.usuarioId) {
    return (
      <ProductStatusView
        ean13={getProductStatusEan13(currentPath)}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  return <ViewPlaceholder node={node} />;
}

function ViewPlaceholder({ node }: { node: NavNode }): ReactElement {
  const relatedControllers = node.controllerIds
    .map((id) => findControllerById(id))
    .filter(isControllerMetadata);

  return (
    <section className="px-8 py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-[#2d6a4f]">
            {node.viewName}
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-[#17202a]">
            {node.label}
          </h3>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <Info label="Ruta" value={node.path} />
            <Info label="Grupo" value={navGroupLabels[node.group]} />
            <Info
              label="Roles"
              value={node.roles.length > 0 ? node.roles.join(', ') : 'publico'}
            />
            <Info label="Entrada" value={node.entryFrom} />
          </dl>
        </article>
        <aside className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-[#17202a]">
            Controladores
          </h3>
          <div className="mt-4 grid gap-3">
            {relatedControllers.map((controller) => (
              <div
                className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-3"
                key={controller.id}
              >
                <p className="text-sm font-semibold text-[#244d61]">
                  {controller.name}
                </p>
                <p className="mt-1 text-xs text-[#61717f]">
                  {controller.channels.join(', ')}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <InternalComponents />
    </section>
  );
}

function InternalComponents(): ReactElement {
  return (
    <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-[#17202a]">
        Componentes internos
      </h3>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {internalComponents.map((component) => (
          <div
            className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-3"
            key={component.id}
          >
            <p className="text-sm font-semibold text-[#244d61]">
              {component.id} {component.name}
            </p>
            <p className="mt-1 text-xs text-[#61717f]">
              {component.usedIn.join(', ')}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#61717f]">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-[#24313d]">{value}</dd>
    </div>
  );
}

function navigate(path: string): void {
  if (getHashPath() === path) {
    return;
  }

  window.location.hash = path;
}

function auditRouteAccess(
  pathname: string,
  session: AppSession,
  decision: RouteGuardDecision,
  lastRouteAuditKey: { current: string | null },
): void {
  if (!pathname.startsWith('/app') || !session.usuarioId) {
    return;
  }

  if (decision.status === 'redirect') {
    return;
  }

  const node = findNavNodeByPath(pathname);
  const result = decision.status === 'allow' ? 'concedido' : 'denegado';
  const key = `${session.usuarioId}:${pathname}:${result}`;

  if (lastRouteAuditKey.current === key) {
    return;
  }

  lastRouteAuditKey.current = key;

  const label = node?.label ?? pathname;
  const moduleLabel = node
    ? navGroupLabels[node.group].toLocaleLowerCase('es')
    : 'acceso';

  void window.appApi
    .invoke('auditoria:registrar', {
      descripcion:
        decision.status === 'allow'
          ? `Acceso concedido a ${label}.`
          : `Acceso denegado a ${label}.`,
      modulo: moduleLabel,
      tipoAccion:
        decision.status === 'allow' ? 'acceso_concedido' : 'acceso_denegado',
      usuarioId: session.usuarioId,
    })
    .catch(() => undefined);
}

function getHashPath(): string {
  const rawPath = window.location.hash.replace(/^#/, '');
  return rawPath.startsWith('/') ? rawPath : PUBLIC_LOGIN_PATH;
}

function getProductEditEan13(path: string): string | undefined {
  const match = path.match(/^\/app\/inventario\/productos\/([^/]+)\/editar$/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function isImplementedViewNodeId(nodeId: string): boolean {
  return [
    'dashboard',
    'attendance',
    'cash-closing',
    'lot-create',
    'product-create',
    'product-edit',
    'product-list',
    'product-status',
    'sale-register',
    'waste-create',
  ].includes(nodeId);
}

export function getProductStatusEan13(path: string): string | undefined {
  const match = path.match(/^\/app\/inventario\/productos\/([^/]+)\/estado$/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function getLotCreateEan13(path: string): string | undefined {
  const [, query = ''] = path.split('?');
  const ean13 = new URLSearchParams(query).get('ean13');

  return ean13 ? decodeURIComponent(ean13) : undefined;
}

export function getWasteCreateEan13(path: string): string | undefined {
  const [, query = ''] = path.split('?');
  const ean13 = new URLSearchParams(query).get('ean13');

  return ean13 ? decodeURIComponent(ean13) : undefined;
}

function isControllerMetadata(
  controller: ControllerMetadata | undefined,
): controller is ControllerMetadata {
  return Boolean(controller);
}
