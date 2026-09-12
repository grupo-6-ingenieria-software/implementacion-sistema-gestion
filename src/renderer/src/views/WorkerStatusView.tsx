import { useState, type ReactElement } from "react";
import type { UserListItem, UserStatus } from "../../../shared/users";

function roleLabel(role: UserListItem["rol"]): string {
  return role === "dueno" ? "Dueño" : "Trabajador";
}

type WorkerStatusViewProps = {
  worker: UserListItem;
  usuarioId: string;
  onClose: () => void;
  onSaved: (estado: UserStatus) => void;
};

export function WorkerStatusView({
  onClose,
  onSaved,
  usuarioId,
  worker,
}: WorkerStatusViewProps): ReactElement {
  const nuevoEstado: UserStatus =
    worker.estado === "activo" ? "inactivo" : "activo";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar(): Promise<void> {
    setSaving(true);
    setError(null);

    const response = await window.appApi.invoke(
      "trabajador:cambiar-estado",
      {
        confirmacion: true,
        estado: nuevoEstado,
        usuarioId,
        usuarioObjetivoId: worker.usuarioId,
      },
    );

    setSaving(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    onSaved(nuevoEstado);
  }

  return (
    <section className="rounded-md bg-white shadow-lg">
      <div className="border-b border-[#e3e8ee] px-6 py-5">
        <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
        <h3 className="mt-1 text-xl font-semibold text-[#17202a]">
          Cambiar estado del trabajador
        </h3>
      </div>
      <div className="grid gap-3 px-6 py-5 text-sm">
        <p className="text-[#24313d]">
          <span className="font-semibold">Trabajador:</span>{" "}
          {worker.nombreCompleto} ({worker.rut})
        </p>
        <p className="text-[#24313d]">
          <span className="font-semibold">Rol de sistema:</span>{" "}
          {roleLabel(worker.rol)}
        </p>
        <p className="text-[#24313d]">
          <span className="font-semibold">Estado actual:</span>{" "}
          {worker.estado === "activo" ? "Activo" : "Inactivo"}
        </p>
        <p className="text-[#24313d]">
          <span className="font-semibold">Estado resultante:</span>{" "}
          <span
            className={`font-semibold ${
              nuevoEstado === "activo" ? "text-[#2d6a4f]" : "text-[#b42318]"
            }`}
          >
            {nuevoEstado === "activo" ? "Activo" : "Inactivo"}
          </span>
        </p>
        {nuevoEstado === "inactivo" ? (
          <p className="rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-[#b42318]">
            Al desactivar se cerraran sus sesiones abiertas y no podra iniciar
            sesion hasta que se reactive.
          </p>
        ) : (
          <p className="rounded-md border border-[#cbd5df] bg-[#f6f9fb] px-3 py-2 text-[#61717f]">
            Reactivar no reabre sesiones anteriores; debera iniciar sesion de
            nuevo.
          </p>
        )}
        {error ? (
          <p className="rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-[#b42318]">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] px-6 py-5">
        <button
          className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
          disabled={saving}
          type="button"
          onClick={() => void confirmar()}
        >
          {saving ? "Guardando..." : "Confirmar"}
        </button>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          disabled={saving}
          type="button"
          onClick={onClose}
        >
          Cancelar
        </button>
      </div>
    </section>
  );
}
