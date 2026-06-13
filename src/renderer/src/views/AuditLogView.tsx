import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  defaultAuditLogPageSize,
  type AuditLogEntry,
  type AuditLogQueryPayload,
  type AuditLogQueryResponse,
} from '../../../shared/audit';

type AuditLogViewProps = {
  usuarioId?: string;
};

export type AuditLogFilters = {
  fechaDesde: string;
  fechaHasta: string;
  tipoAccion: string;
  usuarioFiltroId: string;
};

type AuditLogState =
  | { status: 'loading' }
  | { message: string; status: 'error' }
  | { response: AuditLogQueryResponse; status: 'ready' };

const emptyFilters: AuditLogFilters = {
  fechaDesde: '',
  fechaHasta: '',
  tipoAccion: '',
  usuarioFiltroId: '',
};

export function AuditLogView({ usuarioId }: AuditLogViewProps): ReactElement {
  const [filters, setFilters] = useState<AuditLogFilters>(emptyFilters);
  const [state, setState] = useState<AuditLogState>({ status: 'loading' });
  const initialLoadStartedRef = useRef(false);

  const loadLog = useCallback(
    async (nextFilters: AuditLogFilters, page = 1): Promise<void> => {
      if (!usuarioId?.trim()) {
        setState({
          message: 'Se requiere una sesion valida para consultar el log.',
          status: 'error',
        });
        return;
      }

      setState({ status: 'loading' });

      try {
        const response = await window.appApi.invoke<AuditLogQueryResponse>(
          'auditoria:consultar',
          buildAuditLogQueryPayload(usuarioId, nextFilters, page),
        );

        if (!response.ok) {
          setState({
            message: response.error.message,
            status: 'error',
          });
          return;
        }

        setState({
          response: response.data,
          status: 'ready',
        });
      } catch {
        setState({
          message: 'No fue posible comunicarse con el proceso principal.',
          status: 'error',
        });
      }
    },
    [usuarioId],
  );

  useEffect(() => {
    if (initialLoadStartedRef.current) {
      return;
    }

    initialLoadStartedRef.current = true;
    void loadLog(emptyFilters);
  }, [loadLog]);

  const availableUsers = state.status === 'ready' ? state.response.filters.usuarios : [];
  const availableActions =
    state.status === 'ready' ? state.response.filters.tiposAccion : [];
  const currentPage = state.status === 'ready' ? state.response.page : 1;
  const totalPages = state.status === 'ready' ? state.response.totalPages : 1;
  const pageSummary = useMemo(
    () => (state.status === 'ready' ? getPageSummary(state.response) : ''),
    [state],
  );

  const applyFilters = (): void => {
    void loadLog(filters, 1);
  };

  const clearFilters = (): void => {
    setFilters(emptyFilters);
    void loadLog(emptyFilters, 1);
  };

  const refreshLog = (): void => {
    void loadLog(filters, currentPage);
  };

  const goToPage = (page: number): void => {
    void loadLog(filters, page);
  };

  return (
    <section className="space-y-6 px-8 py-8">
      <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[1fr_220px_180px_180px]">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Usuario
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={filters.usuarioFiltroId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  usuarioFiltroId: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nombre} ({formatRole(user.rol)})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Tipo de accion
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={filters.tipoAccion}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  tipoAccion: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              {availableActions.map((action) => (
                <option key={action} value={action}>
                  {formatAction(action)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Fecha desde
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              type="date"
              value={filters.fechaDesde}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  fechaDesde: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Fecha hasta
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              type="date"
              value={filters.fechaHasta}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  fechaHasta: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-[#e3e8ee] pt-4">
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={refreshLog}
          >
            Actualizar
          </button>
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={clearFilters}
          >
            Limpiar filtros
          </button>
          <button
            className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
            type="button"
            onClick={applyFilters}
          >
            Consultar
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3e8ee] px-5 py-4">
          <p className="text-sm font-semibold text-[#24313d]">
            {state.status === 'ready' ? pageSummary : 'Cargando log...'}
          </p>
          {state.status === 'ready' ? (
            <p className="text-xs font-semibold uppercase text-[#61717f]">
              Orden descendente por fecha y hora
            </p>
          ) : null}
        </div>

        {state.status === 'loading' ? (
          <AuditMessage message="Cargando registros de auditoria..." />
        ) : null}

        {state.status === 'error' ? (
          <AuditMessage
            actionLabel="Intentar nuevamente"
            message={state.message}
            onAction={refreshLog}
          />
        ) : null}

        {state.status === 'ready' && state.response.entries.length === 0 ? (
          <AuditMessage message="No se encontraron movimientos para los filtros indicados." />
        ) : null}

        {state.status === 'ready' && state.response.entries.length > 0 ? (
          <AuditTable entries={state.response.entries} />
        ) : null}

        {state.status === 'ready' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e3e8ee] px-5 py-4">
            <p className="text-sm font-medium text-[#61717f]">
              Pagina {currentPage} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:cursor-not-allowed disabled:text-[#9ba9b5]"
                disabled={currentPage <= 1}
                type="button"
                onClick={() => goToPage(currentPage - 1)}
              >
                Anterior
              </button>
              <button
                className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:cursor-not-allowed disabled:text-[#9ba9b5]"
                disabled={currentPage >= totalPages}
                type="button"
                onClick={() => goToPage(currentPage + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}

export function buildAuditLogQueryPayload(
  usuarioId: string,
  filters: AuditLogFilters,
  page: number,
): AuditLogQueryPayload {
  return {
    fechaDesde: filters.fechaDesde || undefined,
    fechaHasta: filters.fechaHasta || undefined,
    page,
    pageSize: defaultAuditLogPageSize,
    tipoAccion: filters.tipoAccion || undefined,
    usuarioFiltroId: filters.usuarioFiltroId || undefined,
    usuarioId,
  };
}

function AuditTable({
  entries,
}: {
  entries: AuditLogEntry[];
}): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] border-collapse text-left text-sm">
        <thead className="bg-[#f6f7f9] text-xs uppercase text-[#61717f]">
          <tr>
            <th className="px-5 py-3 font-semibold">Fecha y hora</th>
            <th className="px-5 py-3 font-semibold">Usuario</th>
            <th className="px-5 py-3 font-semibold">Rol</th>
            <th className="px-5 py-3 font-semibold">Tipo</th>
            <th className="px-5 py-3 font-semibold">Modulo</th>
            <th className="px-5 py-3 font-semibold">Descripcion</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr className="border-t border-[#edf1f5] align-top" key={entry.id}>
              <td className="px-5 py-4 font-medium text-[#24313d]">
                {formatDateTime(entry.fechaHora)}
              </td>
              <td className="px-5 py-4">
                <p className="font-semibold text-[#17202a]">
                  {entry.usuarioNombre}
                </p>
                <p className="mt-1 font-mono text-xs text-[#61717f]">
                  {entry.usuarioId}
                </p>
              </td>
              <td className="px-5 py-4 text-[#24313d]">
                {formatRole(entry.rol)}
              </td>
              <td className="px-5 py-4">
                <span className="inline-flex rounded-md bg-[#e8f3ed] px-2 py-1 text-xs font-semibold text-[#2d6a4f]">
                  {formatAction(entry.tipoAccion)}
                </span>
              </td>
              <td className="px-5 py-4 text-[#24313d]">
                {formatAction(entry.modulo)}
              </td>
              <td className="max-w-[380px] px-5 py-4 text-[#24313d]">
                {entry.descripcion}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditMessage({
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

function getPageSummary(response: AuditLogQueryResponse): string {
  if (response.total === 0) {
    return '0 registros';
  }

  const from = (response.page - 1) * response.pageSize + 1;
  const to = Math.min(response.page * response.pageSize, response.total);
  return `${from}-${to} de ${response.total} registros`;
}

function formatAction(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatRole(value: string): string {
  return value.replace('due\u00f1o', 'dueno');
}

export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(date);
}
