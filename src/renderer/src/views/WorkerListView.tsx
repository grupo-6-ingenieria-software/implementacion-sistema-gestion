import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  formatRutInput,
  type UserListItem,
  type UserListResponse,
  type UserMutationResponse,
  type UserRole,
  type UserStatus,
} from "../../../shared/users";
import { WorkerFormView } from "./WorkerFormView";
import { WorkerStatusView } from "./WorkerStatusView";

type WorkerListViewProps = {
  usuarioId: string;
  onNavigate: (path: string) => void;
  role: UserRole;
};

function roleLabel(role: UserRole): string {
  return role === "dueno" ? "Dueño" : "Trabajador";
}

function esRutExacto(busqueda: string): boolean {
  return /^\d{7,8}-[\dKk]$/.test(busqueda.trim());
}

/**
 * Aplica el formato de RUT del login solo cuando la búsqueda parece un RUT
 * (dígitos, K, puntos, guion o espacios); el texto de búsqueda por nombre
 * pasa intacto.
 */
function formatearBusqueda(value: string): string {
  const limpio = value.trim();

  if (limpio !== "" && /\d/.test(limpio) && /^[\dkK.\-\s]+$/.test(limpio)) {
    return formatRutInput(limpio);
  }

  return value;
}

export function WorkerListView({
  onNavigate,
  role,
  usuarioId,
}: WorkerListViewProps): ReactElement {
  const [workers, setWorkers] = useState<UserListItem[]>([]);
  const [search, setSearch] = useState("");
  const [rol, setRol] = useState<UserRole | "todos">("todos");
  const [estado, setEstado] = useState<UserStatus | "todos">("todos");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState<UserListItem | null>(
    null,
  );
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

      const response = await window.appApi.invoke<UserListResponse>(
        "trabajador:listar",
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
      setError("No fue posible cargar los trabajadores. Intente nuevamente.");
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [payload]);

  function startEdit(worker: UserListItem): void {
    setMessage(null);
    setEditing(worker);
  }

  function closeEdit(): void {
    setEditing(null);
  }

  function finishEdit(): void {
    setEditing(null);
    setMessage("Trabajador actualizado correctamente.");
    setReloadKey((current) => current + 1);
  }

  function startStatusChange(worker: UserListItem): void {
    setMessage(null);
    setCambiandoEstado(worker);
  }

  function closeStatusChange(): void {
    setCambiandoEstado(null);
  }

  function finishStatusChange(estado: UserStatus): void {
    setCambiandoEstado(null);
    setMessage(`Trabajador ${estado}.`);
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
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => onNavigate("/app/personal/turnos")}
          >
            Turnos
          </button>
          {role === "dueno" ? (
            <button
              className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
              type="button"
              onClick={() => onNavigate("/app/personal/trabajadores/nuevo")}
            >
              Registrar trabajador
            </button>
          ) : null}
        </div>
      </div>

      <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_180px_180px]">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Buscar por nombre o RUT
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              placeholder="Nombre o RUT"
              value={search}
              onChange={(event) => setSearch(formatearBusqueda(event.target.value))}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Rol
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={rol}
              onChange={(event) =>
                setRol(event.target.value as UserRole | "todos")
              }
            >
              <option value="todos">Todos</option>
              <option value="dueno">{roleLabel("dueno")}</option>
              <option value="trabajador">{roleLabel("trabajador")}</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Estado
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={estado}
              onChange={(event) =>
                setEstado(event.target.value as UserStatus | "todos")
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
        <div className="fixed inset-0 z-40 overflow-y-auto bg-[#17202a]/50 p-6">
          <div className="mx-auto max-w-3xl rounded-md bg-white shadow-lg">
            <WorkerFormView
              mode="edit"
              initialValues={{
                correoElectronico: editing.correoElectronico ?? "",
                nombreCompleto: editing.nombreCompleto,
                rol: editing.rol,
                rut: editing.rut,
                telefono: editing.telefono,
              }}
              usuarioId={usuarioId}
              onClose={closeEdit}
              onNavigate={onNavigate}
              onSaved={finishEdit}
            />
          </div>
        </div>
      ) : null}

      {cambiandoEstado ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-[#17202a]/50 p-6">
          <div className="mx-auto max-w-xl">
            <WorkerStatusView
              usuarioId={usuarioId}
              worker={cambiandoEstado}
              onClose={closeStatusChange}
              onSaved={finishStatusChange}
            />
          </div>
        </div>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-4">
          <p className="text-sm font-semibold text-[#24313d]">
            {loading
              ? "Cargando trabajadores..."
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
          <ListMessage
            message={
              esRutExacto(search)
                ? "Trabajador no encontrado"
                : "No se encontraron trabajadores"
            }
          />
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
                      {role === "dueno" ? (
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
                            onClick={() => startStatusChange(worker)}
                          >
                            {worker.estado === "activo" ? "Inactivar" : "Activar"}
                          </button>
                        </div>
                      ) : null}
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

function StatusBadge({ status }: { status: UserStatus }): ReactElement {
  const active = status === "activo";

  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ${
        active ? "bg-[#e8f3ed] text-[#2d6a4f]" : "bg-[#f0f3f6] text-[#61717f]"
      }`}
    >
      {active ? "Activo" : "Inactivo"}
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
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}
