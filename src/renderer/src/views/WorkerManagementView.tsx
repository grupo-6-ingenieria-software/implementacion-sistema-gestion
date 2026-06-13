import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  defaultUserListFilters,
  formatRoleLabel,
  formatRutInput,
  type UserFieldErrors,
  type UserFormValues,
  type UserListItem,
  type UserListResponse,
  type UserMutationResponse,
  type UserRole,
  type UserRoleFilter,
  type UserSortBy,
  type UserSortDirection,
  type UserStatusFilter,
} from '../../../shared/users';

type WorkerManagementViewProps = {
  initialCreate?: boolean;
  usuarioId: string;
};

type FormMode = 'create' | 'edit';

const emptyForm: UserFormValues = {
  correoElectronico: '',
  nombreCompleto: '',
  rol: 'trabajador',
  rut: '',
  telefono: '',
};

export function WorkerManagementView({
  initialCreate = false,
  usuarioId,
}: WorkerManagementViewProps): ReactElement {
  const [workers, setWorkers] = useState<UserListItem[]>([]);
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
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] = useState<UserFormValues>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<UserFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const initialCreateHandled = useRef(false);

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

    async function loadWorkers(): Promise<void> {
      setLoading(true);
      setError(null);

      const response = await window.appApi.invoke<UserListResponse>(
        'trabajador:listar',
        payload,
      );

      if (!isCurrent) {
        return;
      }

      if (response.ok) {
        setWorkers(response.data.users);
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
  }, [payload, reloadKey]);

  useEffect(() => {
    if (initialCreate && !initialCreateHandled.current) {
      initialCreateHandled.current = true;
      openCreateForm();
    }
  }, [initialCreate]);

  function openCreateForm(): void {
    setFieldErrors({});
    setNotice(null);
    setFormValues(emptyForm);
    setFormMode('create');
  }

  function openEditForm(worker: UserListItem): void {
    setFieldErrors({});
    setNotice(null);
    setFormValues({
      correoElectronico: worker.correoElectronico ?? '',
      nombreCompleto: worker.nombreCompleto,
      rol: worker.rol,
      rut: worker.rut,
      telefono: worker.telefono,
    });
    setFormMode('edit');
  }

  async function submitForm(): Promise<void> {
    if (!formMode) {
      return;
    }

    setSaving(true);
    setFieldErrors({});
    setNotice(null);

    const channel =
      formMode === 'create' ? 'trabajador:registrar' : 'trabajador:actualizar';
    const response = await window.appApi.invoke<UserMutationResponse>(channel, {
      ...formValues,
      usuarioId,
    });

    setSaving(false);

    if (response.ok) {
      setFormMode(null);
      setNotice(
        formMode === 'create'
          ? 'Trabajador registrado con cuenta asociada.'
          : 'Trabajador actualizado.',
      );
      setReloadKey((current) => current + 1);
      return;
    }

    setFieldErrors(response.error.fieldErrors ?? {});
    setNotice(response.error.message);
  }

  async function changeWorkerStatus(worker: UserListItem): Promise<void> {
    const nextStatus = worker.estado === 'activo' ? 'inactivo' : 'activo';
    const confirmed = window.confirm(
      `Confirme que desea dejar a ${worker.nombreCompleto} como ${nextStatus}.`,
    );

    if (!confirmed) {
      return;
    }

    setNotice(null);

    const response = await window.appApi.invoke<UserMutationResponse>(
      'trabajador:cambiar-estado',
      {
        estado: nextStatus,
        usuarioId,
        usuarioObjetivoId: worker.usuarioId,
      },
    );

    if (response.ok) {
      setNotice(`Estado actualizado a ${nextStatus}.`);
      setReloadKey((current) => current + 1);
    } else {
      setNotice(response.error.message);
    }
  }

  return (
    <section className="px-8 py-8">
      <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_180px_180px]">
            <FilterInput label="Buscar" value={search} onChange={setSearch} />
            <RoleFilter value={rol} onChange={setRol} />
            <StatusFilter value={estado} onChange={setEstado} />
          </div>
          <button
            className="rounded-md bg-[#24313d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#17202a]"
            type="button"
            onClick={openCreateForm}
          >
            Nuevo trabajador
          </button>
        </div>
        <SortControls
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortByChange={setSortBy}
          onSortDirectionChange={setSortDirection}
        />
      </section>

      {notice ? <Notice message={notice} /> : null}

      <WorkerTable
        error={error}
        loading={loading}
        workers={workers}
        onEdit={openEditForm}
        onReload={() => setReloadKey((current) => current + 1)}
        onStatusChange={(worker) => void changeWorkerStatus(worker)}
      />

      {formMode ? (
        <WorkerFormDialog
          errors={fieldErrors}
          mode={formMode}
          saving={saving}
          values={formValues}
          onCancel={() => setFormMode(null)}
          onChange={setFormValues}
          onSubmit={() => void submitForm()}
        />
      ) : null}
    </section>
  );
}

function WorkerTable({
  error,
  loading,
  onEdit,
  onReload,
  onStatusChange,
  workers,
}: {
  error: string | null;
  loading: boolean;
  onEdit: (worker: UserListItem) => void;
  onReload: () => void;
  onStatusChange: (worker: UserListItem) => void;
  workers: UserListItem[];
}): ReactElement {
  return (
    <section className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-4">
        <p className="text-sm font-semibold text-[#24313d]">
          {loading ? 'Cargando trabajadores...' : `${workers.length} trabajadores`}
        </p>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={onReload}
        >
          Actualizar
        </button>
      </div>

      {error ? (
        <TableMessage
          actionLabel="Intentar nuevamente"
          message={error}
          onAction={onReload}
        />
      ) : null}
      {!error && loading ? (
        <TableMessage message="Cargando informacion de trabajadores..." />
      ) : null}
      {!error && !loading && workers.length === 0 ? (
        <TableMessage message="No se encontraron trabajadores" />
      ) : null}
      {!error && !loading && workers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-[#f6f7f9] text-xs uppercase text-[#61717f]">
              <tr>
                <th className="px-5 py-3 font-semibold">Trabajador</th>
                <th className="px-5 py-3 font-semibold">Rol</th>
                <th className="px-5 py-3 font-semibold">Contacto</th>
                <th className="px-5 py-3 font-semibold">Ingreso</th>
                <th className="px-5 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr
                  className="border-t border-[#edf1f5] align-top"
                  key={worker.usuarioId}
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[#17202a]">
                      {worker.nombreCompleto}
                    </p>
                    <p className="mt-1 font-mono text-xs text-[#61717f]">
                      {worker.rut}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <Badge>{formatRoleLabel(worker.rol)}</Badge>
                  </td>
                  <td className="px-5 py-4 text-[#24313d]">
                    <p className="font-semibold">{worker.telefono}</p>
                    <p className="mt-1 text-xs text-[#61717f]">
                      {worker.correoElectronico ?? 'Sin correo'}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-[#24313d]">
                    {formatDate(worker.fechaIngreso)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge estado={worker.estado} />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      <SmallButton onClick={() => onEdit(worker)}>
                        Editar
                      </SmallButton>
                      <SmallButton onClick={() => onStatusChange(worker)}>
                        {worker.estado === 'activo' ? 'Inactivar' : 'Activar'}
                      </SmallButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function WorkerFormDialog({
  errors,
  mode,
  onCancel,
  onChange,
  onSubmit,
  saving,
  values,
}: {
  errors: UserFieldErrors;
  mode: FormMode;
  onCancel: () => void;
  onChange: (values: UserFormValues) => void;
  onSubmit: () => void;
  saving: boolean;
  values: UserFormValues;
}): ReactElement {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#17202a]/40 px-4">
      <section className="w-full max-w-2xl rounded-md border border-[#cbd5df] bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#e3e8ee] pb-4">
          <h2 className="text-lg font-semibold text-[#17202a]">
            {mode === 'create' ? 'Nuevo trabajador' : 'Editar trabajador'}
          </h2>
          <SmallButton onClick={onCancel}>Cerrar</SmallButton>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <FormInput
            disabled={mode === 'edit'}
            error={errors.rut}
            label="RUT"
            value={values.rut}
            onChange={(rut) => onChange({ ...values, rut: formatRutInput(rut) })}
          />
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Rol
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={values.rol}
              onChange={(event) =>
                onChange({ ...values, rol: event.target.value as UserRole })
              }
            >
              <option value="trabajador">Trabajador</option>
              <option value="dueno">Dueño</option>
            </select>
            {errors.rol ? <FieldError message={errors.rol} /> : null}
          </label>
          <FormInput
            className="md:col-span-2"
            error={errors.nombreCompleto}
            label="Nombre completo"
            value={values.nombreCompleto}
            onChange={(nombreCompleto) =>
              onChange({ ...values, nombreCompleto })
            }
          />
          <FormInput
            error={errors.telefono}
            label="Telefono"
            value={values.telefono}
            onChange={(telefono) => onChange({ ...values, telefono })}
          />
          <FormInput
            error={errors.correoElectronico}
            label="Correo electronico"
            value={values.correoElectronico ?? ''}
            onChange={(correoElectronico) =>
              onChange({ ...values, correoElectronico })
            }
          />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-[#e3e8ee] pt-4">
          <SmallButton onClick={onCancel}>Cancelar</SmallButton>
          <button
            className="rounded-md bg-[#24313d] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
            disabled={saving}
            type="button"
            onClick={onSubmit}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </section>
    </div>
  );
}

function FilterInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
      {label}
      <input
        className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
        placeholder="Nombre o RUT"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function RoleFilter({
  onChange,
  value,
}: {
  onChange: (value: UserRoleFilter) => void;
  value: UserRoleFilter;
}): ReactElement {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
      Rol
      <select
        className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
        value={value}
        onChange={(event) => onChange(event.target.value as UserRoleFilter)}
      >
        <option value="todos">Todos</option>
        <option value="dueno">Dueño</option>
        <option value="trabajador">Trabajador</option>
      </select>
    </label>
  );
}

function StatusFilter({
  onChange,
  value,
}: {
  onChange: (value: UserStatusFilter) => void;
  value: UserStatusFilter;
}): ReactElement {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
      Estado
      <select
        className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
        value={value}
        onChange={(event) => onChange(event.target.value as UserStatusFilter)}
      >
        <option value="todos">Todos</option>
        <option value="activo">Activo</option>
        <option value="inactivo">Inactivo</option>
      </select>
    </label>
  );
}

function SortControls({
  onSortByChange,
  onSortDirectionChange,
  sortBy,
  sortDirection,
}: {
  onSortByChange: (value: UserSortBy) => void;
  onSortDirectionChange: (value: UserSortDirection) => void;
  sortBy: UserSortBy;
  sortDirection: UserSortDirection;
}): ReactElement {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#e3e8ee] pt-4">
      <label className="flex items-center gap-2 text-sm font-semibold text-[#24313d]">
        Ordenar por
        <select
          className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
          value={sortBy}
          onChange={(event) => onSortByChange(event.target.value as UserSortBy)}
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
            onSortDirectionChange(event.target.value as UserSortDirection)
          }
        >
          <option value="asc">Ascendente</option>
          <option value="desc">Descendente</option>
        </select>
      </label>
    </div>
  );
}

function FormInput({
  className,
  disabled,
  error,
  label,
  onChange,
  value,
}: {
  className?: string;
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  return (
    <label className={`grid gap-2 text-sm font-semibold text-[#24313d] ${className ?? ''}`}>
      {label}
      <input
        className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal disabled:bg-[#edf1f5]"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <FieldError message={error} /> : null}
    </label>
  );
}

function StatusBadge({ estado }: { estado: UserListItem['estado'] }): ReactElement {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
        estado === 'activo'
          ? 'bg-[#e3f4ea] text-[#2d6a4f]'
          : 'bg-[#edf1f5] text-[#61717f]'
      }`}
    >
      {capitalize(estado)}
    </span>
  );
}

function Badge({ children }: { children: string }): ReactElement {
  return (
    <span className="inline-flex rounded-md bg-[#edf1f5] px-2 py-1 text-xs font-semibold text-[#244d61]">
      {children}
    </span>
  );
}

function SmallButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className="rounded-md border border-[#9ba9b5] px-2 py-1 text-xs font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Notice({ message }: { message: string }): ReactElement {
  return (
    <div className="mt-4 rounded-md border border-[#b9c8d6] bg-[#f6f9fb] px-4 py-3 text-sm font-semibold text-[#24313d]">
      {message}
    </div>
  );
}

function FieldError({ message }: { message: string }): ReactElement {
  return <span className="text-xs font-semibold text-[#a33a2c]">{message}</span>;
}

function TableMessage({
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
        <SmallButton onClick={onAction}>{actionLabel}</SmallButton>
      ) : null}
    </div>
  );
}

function formatDate(value: string): string {
  return value ? value.slice(0, 10) : 'sin fecha';
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
