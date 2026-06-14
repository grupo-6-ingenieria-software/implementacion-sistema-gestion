import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
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
  navGroupLabels,
  navigationTree,
  resolveInitialRoute,
  type NavNode,
  type Role,
  type RouteGuardDecision,
  type SessionState,
} from '../../shared/navigation';
import {
  SESSION_EXPIRED_MESSAGE,
  SESSION_HEARTBEAT_MS,
  validatePasswordComplexity,
} from '../../shared/auth';
import { formatRutInput, rutToBackend } from '../../shared/users';
import { AuditLogView } from './views/AuditLogView';
import { DailySalesView } from './views/DailySalesView';
import { DashboardView } from './views/DashboardView';
import { AttendanceView } from './views/AttendanceView';
import { CashClosingView } from './views/CashClosingView';
import { LotCreateView } from './views/LotCreateView';
import { ProductFormView } from './views/ProductFormView';
import { ProductDeleteView } from './views/ProductDeleteView';
import { ProductListView } from './views/ProductListView';
import { ProductStatusView } from './views/ProductStatusView';
import { SaleRegisterView } from './views/SaleRegisterView';
import { ShiftCalendarView } from './views/ShiftCalendarView';
import { ShiftCreateView } from './views/ShiftCreateView';
import { UserManagementView } from './views/UserManagementView';
import { WorkerManagementView } from './views/WorkerManagementView';
import { WasteCreateView } from './views/WasteCreateView';
import { WorkerFormView } from './views/WorkerFormView';
import { WorkerListView } from './views/WorkerListView';

type AppSession = SessionState & {
  displayName?: string;
  usuarioId?: string;
  trabajadorNombre?: string;
  usuarioRol?: string;
  token?: string;
};

const defaultSession: AppSession = {
  isAuthenticated: false,
};

type LoginData = {
  token: string;
  role: Role;
  usuarioId: string;
  trabajadorNombre: string;
  usuarioRol: string;
  passwordChangeRequired: boolean;
};

export function App(): ReactElement {
  const [session, setSession] = useState<AppSession>(defaultSession);
  const [path, setPath] = useState(getHashPath);
  const [notice, setNotice] = useState<string | null>(null);
  const lastRouteAuditKey = useRef<string | null>(null);
  const isAuthenticatedRef = useRef(session.isAuthenticated);

  // Refleja en un ref la autenticación vigente para que el latido pueda
  // detenerse sin recrear el intervalo en cada render.
  isAuthenticatedRef.current = session.isAuthenticated;

  // Restablece la sesión por expiración/inactividad (RF55, CU56 e4): limpia el
  // token del preload, vuelve al login y muestra el mensaje exigido. Se usa
  // tanto desde el latido como desde cualquier push de expiración.
  const expireSession = useRef((): void => {
    window.appApi.setSessionToken(null);
    setSession(defaultSession);
    setNotice(SESSION_EXPIRED_MESSAGE);
    navigate(PUBLIC_LOGIN_PATH);
  }).current;

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
      return;
    }

    // Validación de acceso en el proceso principal contra el JWT (RF56/CU57).
    // El guard cliente (evaluateRouteAccess) da UX instantánea; ésta confirma
    // con identidad de confianza y redirige al dashboard ante un FORBIDDEN.
    if (path.startsWith('/app') && session.isAuthenticated) {
      let cancelled = false;

      void window.appApi
        .invoke('access:validate', { ruta: path })
        .then((response) => {
          if (
            !cancelled &&
            !response.ok &&
            response.error.code === 'FORBIDDEN'
          ) {
            navigate(APP_HOME_PATH);
          }
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
      };
    }

    return;
  }, [path, session]);

  // Latido de sesión (RF55, CU56 e4): mientras haya sesión activa, consulta cada
  // 60 s a auth:verificar-sesion (el preload adjunta el token). Este latido es de
  // SÓLO LECTURA: sólo CONSULTA si la sesión sigue vigente y NO reinicia el
  // contador de inactividad. El último acceso lo refresca el dispatcher en cada
  // IPC de acción real del usuario (todo canal autenticado salvo el propio latido
  // y el logout). Así, si la app queda abierta sin que el usuario haga nada,
  // session.ts cierra la fila sesion_usuario tras 30 min de inactividad y responde
  // active=false; entonces este latido detecta el cierre y dispara la expiración.
  useEffect(() => {
    if (!session.isAuthenticated) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!isAuthenticatedRef.current) {
        return;
      }

      void window.appApi
        .invoke<{ active: boolean }>('auth:verificar-sesion', {})
        .then((response) => {
          if (!isAuthenticatedRef.current) {
            return;
          }

          // Una respuesta válida con active=false (inactividad/cierre) o un
          // fallo del canal autenticado significan que la sesión ya no es válida.
          if (!response.ok || !response.data.active) {
            expireSession();
          }
        })
        .catch(() => undefined);
    }, SESSION_HEARTBEAT_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [session.isAuthenticated, expireSession]);

  const login = (data: LoginData): void => {
    const nextSession: AppSession = {
      isAuthenticated: true,
      role: data.role,
      passwordChangeRequired: data.passwordChangeRequired,
      displayName: data.trabajadorNombre,
      usuarioId: data.usuarioId,
      trabajadorNombre: data.trabajadorNombre,
      usuarioRol: data.usuarioRol,
      token: data.token,
    };

    // Registra el token de sesión en el preload para que se adjunte a cada
    // invoke posterior y el dispatcher pueda verificar identidad y rol.
    window.appApi.setSessionToken(data.token);
    setNotice(null);
    setSession(nextSession);
    navigate(resolveInitialRoute(nextSession));
  };

  const logout = (): void => {
    // Cierre manual en la BD (CU56): session.ts marca motivo_cierre='manual' y
    // fecha_hora_cierre sobre la sesión activa. El sesionId se toma del JWT en el
    // dispatcher, no de un parámetro del renderer. Se invoca con el token aún
    // vigente, antes de limpiarlo del preload.
    void window.appApi.invoke('auth:logout', {}).catch(() => undefined);
    window.appApi.setSessionToken(null);
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
    return <LoginView notice={notice} onLogin={login} />;
  }

  if (path === PASSWORD_CHANGE_PATH) {
    return (
      <PasswordChangeView
        usuarioId={session.usuarioId}
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

type DebugUserItem = {
  usuarioId: string;
  nombre: string;
  rol: string;
};

function LoginView({
  notice,
  onLogin,
}: {
  notice: string | null;
  onLogin: (data: LoginData) => void;
}): ReactElement {
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!usuario.trim() || !contrasena) {
      setError('Ingrese usuario y contraseña.');
      return;
    }

    setIsLoading(true);

    const response = await window.appApi.invoke<LoginData>('auth:login', {
      usuario: rutToBackend(usuario),
      contrasena,
    });

    setIsLoading(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    onLogin(response.data);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf1f5] px-6">
      <section className="w-full max-w-[420px] rounded-md border border-[#c8d2dc] bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-[#2d6a4f]">Login</p>
        <h1 className="mt-3 text-2xl font-semibold text-[#17202a]">
          Sistema de Gestion Huascar
        </h1>
        {notice ? (
          <p className="mt-4 rounded-md border border-[#b9c8d6] bg-[#f6f9fb] px-3 py-2 text-sm font-medium text-[#24313d]">
            {notice}
          </p>
        ) : null}
        <form
          className="mt-8 grid gap-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Usuario
            <input
              autoFocus
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              inputMode="numeric"
              maxLength={12}
              name="usuario"
              placeholder="RUT (sin puntos)"
              value={usuario}
              onChange={(event) => setUsuario(formatRutInput(event.target.value))}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Contraseña
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              name="contrasena"
              type="password"
              value={contrasena}
              onChange={(event) => setContrasena(event.target.value)}
            />
          </label>
          <button
            className="rounded-md bg-[#244d61] px-4 py-3 text-center font-semibold text-white transition hover:bg-[#1f4354] disabled:opacity-60"
            disabled={isLoading}
            type="submit"
          >
            {isLoading ? 'Entrando...' : 'Iniciar sesión'}
          </button>
          {error ? (
            <p className="rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-sm font-medium text-[#b42318]">
              {error}
            </p>
          ) : null}
        </form>
        {window.appApi.debugMode ? <DebugLoginPanel onLogin={onLogin} /> : null}
      </section>
    </main>
  );
}

// Panel visible sólo en `npm run dev:debug` (window.appApi.debugMode): lista los
// usuarios activos y permite iniciar sesión como cualquiera sin contraseña.
function DebugLoginPanel({
  onLogin,
}: {
  onLogin: (data: LoginData) => void;
}): ReactElement {
  const [users, setUsers] = useState<DebugUserItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void window.appApi
      .invoke<DebugUserItem[]>('debug:listar-usuarios', {})
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (response.ok) {
          setUsers(response.data);
        } else {
          setError(response.error.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('No se pudo cargar la lista de usuarios.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loginAs = async (usuarioId: string): Promise<void> => {
    setError(null);
    setPendingId(usuarioId);

    const response = await window.appApi.invoke<LoginData>('debug:login-como', {
      usuarioId,
    });

    setPendingId(null);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    onLogin(response.data);
  };

  return (
    <div className="mt-8 rounded-md border border-dashed border-[#c79a2b] bg-[#fdf6e3] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8a5a12]">
        Modo debug · iniciar sesión como
      </p>
      {error ? (
        <p className="mt-3 rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-sm font-medium text-[#b42318]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2">
        {users.length === 0 && !error ? (
          <p className="text-sm text-[#8a6d2f]">Cargando usuarios…</p>
        ) : null}
        {users.map((user) => (
          <button
            key={user.usuarioId}
            className="flex items-center justify-between gap-3 rounded-md border border-[#d8c388] bg-white px-3 py-2 text-left text-sm transition hover:bg-[#fcf3d8] disabled:opacity-60"
            disabled={pendingId !== null}
            type="button"
            onClick={() => void loginAs(user.usuarioId)}
          >
            <span>
              <span className="font-semibold text-[#24313d]">{user.nombre}</span>
              <span className="ml-2 text-xs text-[#61717f]">
                {user.usuarioId} · {user.rol}
              </span>
            </span>
            <span className="text-xs font-semibold text-[#8a5a12]">
              {pendingId === user.usuarioId ? 'Entrando…' : 'Entrar'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PasswordChangeView({
  usuarioId,
  onComplete,
  onLogout,
}: {
  usuarioId: string | undefined;
  onComplete: () => void;
  onLogout: () => void;
}): ReactElement {
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!usuarioId) {
      setError('No hay una sesión válida para cambiar la contraseña.');
      return;
    }

    if (nueva !== confirmacion) {
      setError('La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    const complejidad = validatePasswordComplexity(nueva);

    if (!complejidad.valid) {
      setError(
        complejidad.message ?? 'La nueva contraseña no cumple los requisitos.',
      );
      return;
    }

    setIsLoading(true);

    const response = await window.appApi.invoke('auth:cambiar-password', {
      usuarioId,
      contrasenaNueva: nueva,
    });

    setIsLoading(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    onComplete();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf1f5] px-6">
      <section className="w-full max-w-[460px] rounded-md border border-[#c8d2dc] bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-[#8a5a12]">
          Cambio obligatorio
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-[#17202a]">
          Cambio obligatorio de contraseña
        </h1>
        <p className="mt-2 text-sm text-[#61717f]">
          Debe definir una contraseña definitiva (mínimo 8 caracteres, con
          mayúscula, minúscula y número) antes de acceder al sistema.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Nueva contraseña
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              type="password"
              value={nueva}
              onChange={(event) => setNueva(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Confirmar nueva contraseña
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              type="password"
              value={confirmacion}
              onChange={(event) => setConfirmacion(event.target.value)}
            />
          </label>
          <button
            className="rounded-md bg-[#244d61] px-4 py-3 text-center font-semibold text-white transition hover:bg-[#1f4354] disabled:opacity-60"
            disabled={isLoading}
            type="submit"
          >
            {isLoading ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
          {error ? (
            <p className="rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-sm font-medium text-[#b42318]">
              {error}
            </p>
          ) : null}
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-2 text-center text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={onLogout}
          >
            Cerrar sesión
          </button>
        </form>
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
          <h2 className="text-2xl font-semibold">{currentNode.label}</h2>
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

  if (node.id === 'daily-sales' && session.usuarioId) {
    return <DailySalesView usuarioId={session.usuarioId} />;
  }

  if (node.id === 'shift-calendar' && session.usuarioId) {
    return (
      <ShiftCalendarView
        onNavigate={onNavigate}
        usuarioId={session.usuarioId}
      />
    );
  }

  if (node.id === 'shift-create' && session.usuarioId) {
    return (
      <ShiftCreateView
        currentPath={currentPath}
        onNavigate={onNavigate}
        usuarioId={session.usuarioId}
      />
    );
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

  if ((node.id === 'worker-list' || node.id === 'worker-create') && session.usuarioId) {
    return (
      <WorkerManagementView
        initialCreate={node.id === 'worker-create'}
        usuarioId={session.usuarioId}
      />
    );
  }

  if (node.id === 'user-management' && session.usuarioId) {
    return (
      <UserManagementView
        usuarioId={session.usuarioId}
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

  if (node.id === 'product-delete' && session.usuarioId) {
    return (
      <ProductDeleteView
        initialEan13={getProductDeleteEan13(currentPath)}
        usuarioId={session.usuarioId}
        onNavigate={onNavigate}
      />
    );
  }

  if (node.id === 'worker-list' && session.usuarioId) {
    return (
      <WorkerListView usuarioId={session.usuarioId} onNavigate={onNavigate} />
    );
  }

  if (node.id === 'worker-create' && session.usuarioId) {
    return (
      <WorkerFormView usuarioId={session.usuarioId} onNavigate={onNavigate} />
    );
  }

  return <ViewUnavailable />;
}

export const VIEW_UNAVAILABLE_TITLE = 'Vista no disponible';
export const VIEW_UNAVAILABLE_MESSAGE =
  'La vista solicitada no está disponible.';

function ViewUnavailable(): ReactElement {
  return (
    <section className="px-8 py-8">
      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <h3 className="text-2xl font-semibold text-[#17202a]">
          {VIEW_UNAVAILABLE_TITLE}
        </h3>
        <p className="mt-3 text-sm text-[#61717f]">
          {VIEW_UNAVAILABLE_MESSAGE}
        </p>
      </article>
    </section>
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
    'daily-sales',
    'lot-create',
    'product-create',
    'product-edit',
    'product-delete',
    'product-list',
    'product-status',
    'sale-register',
    'audit-log',
    'shift-calendar',
    'shift-create',
    'waste-create',
    'worker-create',
    'worker-list',
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

export function getProductDeleteEan13(path: string): string | undefined {
  const [, query = ''] = path.split('?');
  const ean13 = new URLSearchParams(query).get('ean13');

  return ean13 ? decodeURIComponent(ean13) : undefined;
}
