import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  normalizeWorkerFormValues,
  roleLabel,
  validateWorkerFormValues,
  type WorkerFieldErrors,
  type WorkerFormValues,
  type WorkerListItem,
  type WorkerListResponse,
  type WorkerMutationResponse,
  type WorkerRole,
  type WorkerStatus,
} from '../../../shared/workers';

type WorkerListViewProps = {
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type EditState = WorkerFormValues & {
  originalRut: string;
};

export function WorkerListView({
  onNavigate,
  usuarioId,
}: WorkerListViewProps): ReactElement {
  const [workers, setWorkers] = useState<WorkerListItem[]>([]);
  const [search, setSearch] = useState('');
  const [rol, setRol] = useState<WorkerRole | 'todos'>('todos');
  const [estado, setEstado] = useState<WorkerStatus | 'todos'>('todos');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<WorkerFieldErrors>({});
  const [reloadKey, setReloadKey] = useState(0);

  const payload = useMemo(
    () => ({
      usuarioId,
      search,
      rol,
      estado,
    }),
    [estado, reloadKey, rol, search, usuarioId],
  );

  useEffect(() => {
    let isCurrent = true;

    async function loadWorkers(): Promise<void> {
      setLoading(true);
      setError(null);

      const response = await window.appApi.invoke<WorkerListResponse>(
        'trabajador:listar',
        payload,
      );

      if (!isCurrent) {
        return;
      }

      if (response.ok) {
        setWorkers(response.data.workers);
      } else {
        setWorkers([]);
        setError(response.error.message);
      }

      setLoading(false);
    }

    loadWorkers().catch(() => {
      if (!isCurrent) {
        return;
      }

      setWorkers([]);
      setError('No fue posible cargar los trabajadores. Intente nuevamente.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [payload]);

  function startEdit(worker: WorkerListItem): void {
    setMessage(null);
    setFieldErrors({});
    setEditing({
      originalRut: worker.rut,
      rut: worker.rut,
      nombreCompleto: worker.nombreCompleto,
      rol: worker.rol,
      telefono: worker.telefono,
      correo: worker.correo ?? '',
    });
  }

  async function saveEdit(): Promise<void> {
    if (!editing) {
      return;
    }

    const parsed = normalizeWorkerFormValues(editing);
    const errors = validateWorkerFormValues(parsed);
    setFieldErrors(errors);
    setMessage(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSaving(true);

    const response = await window.appApi.invoke<WorkerMutationResponse>(
      'trabajador:editar',
      {
        ...parsed,
        rut: editing.originalRut,
        usuarioId,
      },
    );

    setSaving(false);

    if (!response.ok) {
      setFieldErrors(response.error.fieldErrors ?? {});
      setMessage(response.error.message);
      return;
    }

    setEditing(null);
    setMessage('Trabajador actualizado correctamente.');
    setReloadKey((current) => current + 1);
  }

  async function changeStatus(worker: WorkerListItem): Promise<void> {
    const nextStatus = worker.estado === 'activo' ? 'inactivo' : 'activo';
    const confirmed = window.confirm(
      `Confirmar cambio de estado de ${worker.nombreCompleto} a ${nextStatus}.`,
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setMessage(null);

    const response = await window.appApi.invoke<WorkerMutationResponse>(
      'trabajador:cambiar-estado',
      {
        rut: worker.rut,
        estado: nextStatus,
        usuarioId,
      },
    );

    setSaving(false);

    if (!response.ok) {
      setMessage(response.error.message);
      return;
    }

    setMessage(`Trabajador ${nextStatus}.`);
    setReloadKey((current) => current + 1);
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            Trabajadores
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-[#61717f]">
            Consulta trabajadores registrados y filtra por nombre, RUT, rol de
            sistema o estado.
          </p>
        </div>
        <button
          className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
          type="button"
          onClick={() => onNavigate('/app/personal/trabajadores/nuevo')}
        >
          Registrar trabajador
        </button>
      </div>

      <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_180px_180px]">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Buscar por nombre o RUT
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              placeholder="Nombre o RUT"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Rol
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={rol}
              onChange={(event) =>
                setRol(event.target.value as WorkerRole | 'todos')
              }
            >
              <option value="todos">Todos</option>
              <option value="dueno">{roleLabel('dueno')}</option>
              <option value="trabajador">{roleLabel('trabajador')}</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Estado
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={estado}
              onChange={(event) =>
                setEstado(event.target.value as WorkerStatus | 'todos')
              }
            >
              <option value="todos">Todos</option>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex justify-end border-t border-[#e3e8ee] pt-4">
          <button
            className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            Actualizar
          </button>
        </div>
      </section>

      {message ? (
        <p className="mt-4 rounded-md border border-[#b7dfc8] bg-[#effaf3] px-3 py-2 text-sm font-semibold text-[#2d6a4f]">
          {message}
        </p>
      ) : null}

      {editing ? (
        <EditPanel
          editing={editing}
          errors={fieldErrors}
          saving={saving}
          onCancel={() => {
            setEditing(null);
            setFieldErrors({});
          }}
          onChange={setEditing}
          onSave={() => void saveEdit()}
        />
      ) : null}

      <section className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-4">
          <p className="text-sm font-semibold text-[#24313d]">
            {loading
              ? 'Cargando trabajadores...'
              : `${workers.length} trabajadores`}
          </p>
        </div>

        {error ? (
          <ListMessage
            actionLabel="Intentar nuevamente"
            message={error}
            onAction={() => setReloadKey((current) => current + 1)}
          />
        ) : null}

        {!error && loading ? (
          <ListMessage message="Cargando informacion de trabajadores..." />
        ) : null}

        {!error && !loading && workers.length === 0 ? (
          <ListMessage message="No se encontraron trabajadores" />
        ) : null}

        {!error && !loading && workers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-left text-sm">
              <thead className="bg-[#f6f7f9] text-xs uppercase text-[#61717f]">
                <tr>
                  <th className="px-5 py-3 font-semibold">RUT</th>
                  <th className="px-5 py-3 font-semibold">Nombre completo</th>
                  <th className="px-5 py-3 font-semibold">Rol</th>
                  <th className="px-5 py-3 font-semibold">Telefono</th>
                  <th className="px-5 py-3 font-semibold">Fecha ingreso</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <tr className="border-t border-[#e3e8ee]" key={worker.rut}>
                    <td className="px-5 py-4 font-mono text-[#24313d]">
                      {worker.rut}
                    </td>
                    <td className="px-5 py-4 font-semibold text-[#17202a]">
                      {worker.nombreCompleto}
                    </td>
                    <td className="px-5 py-4 text-[#24313d]">
                      {roleLabel(worker.rol)}
                    </td>
                    <td className="px-5 py-4 text-[#24313d]">
                      {worker.telefono}
                    </td>
                    <td className="px-5 py-4 text-[#24313d]">
                      {formatDate(worker.fechaIngreso)}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={worker.estado} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md border border-[#9ba9b5] px-3 py-1.5 text-xs font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                          disabled={saving}
                          type="button"
                          onClick={() => startEdit(worker)}
                        >
                          Editar
                        </button>
                        <button
                          className="rounded-md border border-[#9ba9b5] px-3 py-1.5 text-xs font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                          disabled={saving}
                          type="button"
                          onClick={() => void changeStatus(worker)}
                        >
                          {worker.estado === 'activo' ? 'Inactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function EditPanel({
  editing,
  errors,
  onCancel,
  onChange,
  onSave,
  saving,
}: {
  editing: EditState;
  errors: WorkerFieldErrors;
  onCancel: () => void;
  onChange: (state: EditState) => void;
  onSave: () => void;
  saving: boolean;
}): ReactElement {
  return (
    <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#24313d]">
            Modificar trabajador
          </p>
          <p className="mt-1 text-sm text-[#61717f]">
            El RUT identifica al trabajador y no se modifica.
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={onCancel}
        >
          Cerrar
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="RUT" error={errors.rut}>
          <input
            className="w-full rounded-md border border-[#cbd5df] bg-[#f6f7f9] px-3 py-2"
            disabled
            value={editing.originalRut}
          />
        </Field>
        <Field label="Nombre completo" error={errors.nombreCompleto}>
          <input
            className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
            value={editing.nombreCompleto}
            onChange={(event) =>
              onChange({ ...editing, nombreCompleto: event.target.value })
            }
          />
        </Field>
        <Field label="Rol de sistema" error={errors.rol}>
          <select
            className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
            value={editing.rol}
            onChange={(event) =>
              onChange({
                ...editing,
                rol: event.target.value === 'dueno' ? 'dueno' : 'trabajador',
              })
            }
          >
            <option value="trabajador">{roleLabel('trabajador')}</option>
            <option value="dueno">{roleLabel('dueno')}</option>
          </select>
        </Field>
        <Field label="Telefono" error={errors.telefono}>
          <input
            className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
            inputMode="numeric"
            maxLength={9}
            value={editing.telefono}
            onChange={(event) =>
              onChange({
                ...editing,
                telefono: event.target.value.replace(/\D/g, ''),
              })
            }
          />
        </Field>
        <Field label="Correo opcional" error={errors.correo}>
          <input
            className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
            maxLength={50}
            type="email"
            value={editing.correo ?? ''}
            onChange={(event) =>
              onChange({ ...editing, correo: event.target.value })
            }
          />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
        <button
          className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
          disabled={saving}
          type="button"
          onClick={onSave}
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </section>
  );
}

function Field({
  children,
  error,
  label,
}: {
  children: ReactElement;
  error?: string;
  label: string;
}): ReactElement {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
      {label}
      {children}
      {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
    </label>
  );
}

function StatusBadge({ status }: { status: WorkerStatus }): ReactElement {
  const active = status === 'activo';

  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ${
        active ? 'bg-[#e8f3ed] text-[#2d6a4f]' : 'bg-[#f0f3f6] text-[#61717f]'
      }`}
    >
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

function ListMessage({
  actionLabel,
  message,
  onAction,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
}): ReactElement {
  return (
    <div className="grid place-items-center gap-3 px-5 py-12 text-center">
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

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}
