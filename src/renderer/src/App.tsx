import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  APP_HOME_PATH,
  PASSWORD_CHANGE_PATH,
  PUBLIC_LOGIN_PATH,
  appMenuGroups,
  evaluateRouteAccess,
  findNavNodeByPath,
  getVisibleMenu,
  navGroupLabels,
  navigationTree,
  internalComponents,
  resolveInitialRoute,
  type NavNode,
  type Role,
  type SessionState,
} from '../../shared/navigation';
import { findControllerById } from '../../shared/controllers';
import type { ControllerMetadata } from '../../shared/controllers';
import { DashboardView } from './views/DashboardView';

type AppSession = SessionState & {
  displayName?: string;
};

const defaultSession: AppSession = {
  isAuthenticated: false,
};

export function App(): ReactElement {
  const [session, setSession] = useState<AppSession>(defaultSession);
  const [path, setPath] = useState(getHashPath);

  useEffect(() => {
    const handleHashChange = (): void => setPath(getHashPath());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const decision = evaluateRouteAccess(path, session);

    if (decision.status !== 'allow') {
      navigate(decision.to);
    }
  }, [path, session]);

  const login = (role: Role, passwordChangeRequired = false): void => {
    const nextSession = {
      isAuthenticated: true,
      role,
      passwordChangeRequired,
      displayName: role === 'dueno' ? 'Dueno' : 'Trabajador',
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
  onLogin: (role: Role, passwordChangeRequired?: boolean) => void;
}): ReactElement {
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
            type="button"
            onClick={() => onLogin('dueno')}
          >
            Entrar como dueno
          </button>
          <button
            className="rounded-md bg-[#2d6a4f] px-4 py-3 text-left font-semibold text-white transition hover:bg-[#255a43]"
            type="button"
            onClick={() => onLogin('trabajador')}
          >
            Entrar como trabajador
          </button>
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-3 text-left font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => onLogin('trabajador', true)}
          >
            Entrar con cambio de contrasena
          </button>
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

  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr] bg-[#f6f7f9] text-[#17202a]">
      <aside className="border-r border-[#cbd5df] bg-[#17202a] text-white">
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
      <main className="min-w-0">
        <header className="flex items-center justify-between border-b border-[#cbd5df] bg-white px-8 py-4">
          <div>
            <p className="text-sm font-semibold text-[#61717f]">
              {currentNode.path}
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
        {currentNode.id === 'dashboard' && session.role ? (
          <DashboardView role={session.role} onNavigate={onNavigate} />
        ) : (
          <ViewPlaceholder node={currentNode} />
        )}
      </main>
    </div>
  );
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

function getHashPath(): string {
  const rawPath = window.location.hash.replace(/^#/, '');
  return rawPath.startsWith('/') ? rawPath : PUBLIC_LOGIN_PATH;
}

function isControllerMetadata(
  controller: ControllerMetadata | undefined,
): controller is ControllerMetadata {
  return Boolean(controller);
}
