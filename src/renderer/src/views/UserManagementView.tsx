import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  defaultUserListFilters,
  formatRoleLabel,
  type UserListItem,
  type UserListResponse,
  type UserPasswordResetRequestResponse,
  type UserRoleFilter,
  type UserSortBy,
  type UserSortDirection,
  type UserStatusFilter,
} from '../../../shared/users';

type UserManagementViewProps = {
  usuarioId: string;
};

export function UserManagementView({
  usuarioId,
}: UserManagementViewProps): ReactElement {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [search, setSearch] = useState('');
  const [rol, setRol] = useState<UserRoleFilter>(
    defaultUserListFilters.rol ?? 'todos',
  );
  const [estado, setEstado] = useState<UserStatusFilter>(
    defaultUserListFilters.estado ?? 'todos',
  );
  const [sortBy, setSortBy] = useState<UserSortBy>(
    defaultUserListFilters.sortBy,
  );
  const [sortDirection, setSortDirection] = useState<UserSortDirection>(
    defaultUserListFilters.sortDirection,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );

  const payload = useMemo(
    () => ({
      usuarioId,
      search,
      rol,
      estado,
      sortBy,
      sortDirection,
    }),
    [estado, rol, search, sortBy, sortDirection, usuarioId],
  );

  useEffect(() => {
    let isCurrent = true;

    async function loadUsers(): Promise<void> {
      setLoading(true);
      setError(null);

      const response = await window.appApi.invoke<UserListResponse>(
        'usuario:listar',
        payload,
      );

      if (!isCurrent) {
        return;
      }

      if (response.ok) {
        setUsers(response.data.users);
      } else {
        setUsers([]);
        setError(response.error.message);
      }

      setLoading(false);
    }

    loadUsers().catch(() => {
      if (!isCurrent) {
        return;
      }

      setUsers([]);
      setError('No fue posible cargar los usuarios. Intente nuevamente.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [payload, reloadKey]);

  async function requestPasswordReset(user: UserListItem): Promise<void> {
    const confirmed = window.confirm(
      `Confirme la solicitud de restablecimiento para ${user.nombreCompleto}.`,
    );

    if (!confirmed) {
      return;
    }

    const response =
      await window.appApi.invoke<UserPasswordResetRequestResponse>(
        'usuario:solicitar-restablecimiento',
        {
          usuarioId,
          usuarioObjetivoId: user.usuarioId,
        },
      );

    if (response.ok) {
      setNotice(null);
      setTemporaryPassword(response.data.contrasenaTemporal);
    } else {
      setNotice(response.error.message);
    }
  }

  return (
    <section className="px-8 py-8">
      <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_180px_180px]">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Buscar
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              placeholder="Nombre, RUT o usuario"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Rol
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={rol}
              onChange={(event) => setRol(event.target.value as UserRoleFilter)}
            >
              <option value="todos">Todos</option>
              <option value="dueno">Dueño</option>
              <option value="trabajador">Trabajador</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Estado
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={estado}
              onChange={(event) =>
                setEstado(event.target.value as UserStatusFilter)
              }
            >
              <option value="todos">Todos</option>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#e3e8ee] pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-[#24313d]">
            Ordenar por
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as UserSortBy)}
            >
              <option value="nombreCompleto">Nombre</option>
              <option value="rol">Rol</option>
              <option value="estado">Estado</option>
              <option value="fechaIngreso">Fecha ingreso</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-[#24313d]">
            Direccion
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={sortDirection}
              onChange={(event) =>
                setSortDirection(event.target.value as UserSortDirection)
              }
            >
              <option value="asc">Ascendente</option>
              <option value="desc">Descendente</option>
            </select>
          </label>
        </div>
      </section>

      {notice ? (
        <div className="mt-4 rounded-md border border-[#b9c8d6] bg-[#f6f9fb] px-4 py-3 text-sm font-semibold text-[#24313d]">
          {notice}
        </div>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-4">
          <p className="text-sm font-semibold text-[#24313d]">
            {loading ? 'Cargando usuarios...' : `${users.length} usuarios`}
          </p>
          <button
            className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            Actualizar
          </button>
        </div>

        {error ? (
          <UserMessage
            actionLabel="Intentar nuevamente"
            message={error}
            onAction={() => setReloadKey((current) => current + 1)}
          />
        ) : null}

        {!error && loading ? (
          <UserMessage message="Cargando informacion de usuarios..." />
        ) : null}

        {!error && !loading && users.length === 0 ? (
          <UserMessage message="No se encontraron usuarios" />
        ) : null}

        {!error && !loading && users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-[#f6f7f9] text-xs uppercase text-[#61717f]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Trabajador</th>
                  <th className="px-5 py-3 font-semibold">Usuario</th>
                  <th className="px-5 py-3 font-semibold">Rol</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Ultimo login</th>
                  <th className="px-5 py-3 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    className="border-t border-[#edf1f5] align-top"
                    key={user.usuarioId}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-[#17202a]">
                        {user.nombreCompleto}
                      </p>
                      <p className="mt-1 font-mono text-xs text-[#61717f]">
                        {user.rut}
                      </p>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-[#24313d]">
                      {user.usuarioId}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-md bg-[#edf1f5] px-2 py-1 text-xs font-semibold text-[#244d61]">
                        {formatRoleLabel(user.rol)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
                          user.estado === 'activo'
                            ? 'bg-[#e3f4ea] text-[#2d6a4f]'
                            : 'bg-[#edf1f5] text-[#61717f]'
                        }`}
                      >
                        {capitalize(user.estado)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#24313d]">
                      {user.ultimoLoginFechaHora
                        ? formatDateTime(user.ultimoLoginFechaHora)
                        : 'Sin registro'}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        className="rounded-md border border-[#9ba9b5] px-2 py-1 text-xs font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                        type="button"
                        onClick={() => void requestPasswordReset(user)}
                      >
                        Restablecer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {temporaryPassword ? (
        <TemporaryPasswordDialog
          password={temporaryPassword}
          onClose={() => setTemporaryPassword(null)}
        />
      ) : null}
    </section>
  );
}

function TemporaryPasswordDialog({
  password,
  onClose,
}: {
  password: string;
  onClose: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="temporary-password-title"
    >
      <div className="w-full max-w-md rounded-md border border-[#cbd5df] bg-white p-6 shadow-lg">
        <h2
          className="text-base font-semibold text-[#17202a]"
          id="temporary-password-title"
        >
          Contraseña temporal generada
        </h2>
        <p className="mt-2 text-sm text-[#61717f]">
          Contraseña temporal (cópiela ahora, no se mostrará de nuevo):
        </p>
        <p className="mt-3 select-all rounded-md border border-[#9ba9b5] bg-[#f6f9fb] px-3 py-2 text-center font-mono text-lg font-semibold tracking-wider text-[#17202a]">
          {password}
        </p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => void copyToClipboard()}
          >
            {copied ? 'Copiada' : 'Copiar'}
          </button>
          <button
            className="rounded-md border border-[#244d61] bg-[#244d61] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#1d3e4f]"
            type="button"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function UserMessage({
  actionLabel,
  message,
  onAction,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
}): ReactElement {
  return (
    <div className="grid justify-items-center gap-3 px-5 py-12 text-center">
      <p className="text-sm font-semibold text-[#61717f]">{message}</p>
      {actionLabel && onAction ? (
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
