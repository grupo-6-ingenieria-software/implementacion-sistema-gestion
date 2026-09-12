import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { AttendanceWorkerOption } from "../../../shared/attendance";
import {
  displayDateToIso,
  normalizeShiftCreatePayload,
  normalizeShiftEditPayload,
  validateShiftEditPayload,
  getWeekStartForDateKey,
  type ShiftCalendarItem,
  type ShiftLookupResponse,
  type ShiftFieldErrors,
  type ShiftMutationResponse,
} from "../../../shared/shifts";

import type { Role } from "../../../shared/navigation";
import { buildShiftCalendarPath, getShiftCalendarContext, getShiftEditId } from "./shift-navigation";

type ShiftCreateViewProps = {
  role?: Role;
  onEditSaved?: (path: string) => void;
  currentPath: string;
  onNavigate: (path: string) => void;
  usuarioId: string;
};

type FormState = {
  trabajadorId: string;
  fecha: string;
  horaInicio: string;
  horaTermino: string;
};

const emptyForm: FormState = {
  trabajadorId: "",
  fecha: "",
  horaInicio: "",
  horaTermino: "",
};

export type ShiftCreateContext = {
  fecha: string;
  trabajadorId?: number;
};

export function getShiftCreateContext(path: string): ShiftCreateContext {
  const [, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const fecha = params.get("fecha")?.trim() ?? "";
  const trabajadorIdText = params.get("trabajadorId")?.trim() ?? "";
  const trabajadorId = Number(trabajadorIdText);

  return {
    fecha: displayDateToIso(fecha) ? fecha : "",
    trabajadorId:
      trabajadorIdText && Number.isInteger(trabajadorId) && trabajadorId > 0
        ? trabajadorId
        : undefined,
  };
}

export function getActivePreselectedWorkerId(
  workers: AttendanceWorkerOption[],
  trabajadorId: number | undefined,
): string {
  return trabajadorId &&
    workers.some((worker) => worker.trabajadorId === trabajadorId)
    ? String(trabajadorId)
    : "";
}

export function ShiftCreateView({
  currentPath, onNavigate, usuarioId, role, onEditSaved,
}: ShiftCreateViewProps): ReactElement {
  const initialContext = useMemo(() => getShiftCreateContext(currentPath), [currentPath]);
  const returnContext = useMemo(() => getShiftCalendarContext(currentPath), [currentPath]);
  const turnoId = getShiftEditId(currentPath);
  const editing = turnoId !== undefined;
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [workers, setWorkers] = useState<AttendanceWorkerOption[]>([]);
  const [shift, setShift] = useState<ShiftCalendarItem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ShiftFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const requestIdRef = useRef(0);
  const savingRef = useRef(false);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blocked = editing && (role !== "dueno" || !shift?.puedeModificar);
  const returnPath = editing ? buildShiftCalendarPath(returnContext) : "/app/personal/turnos";

  const loadForm = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    setFieldErrors({});
    setShift(null);
    setCompleted(false);
    setSaving(false);
    savingRef.current = false;
    setForm({ ...emptyForm, fecha: initialContext.fecha });
    try {
      if (editing) {
        if (role !== "dueno") throw new Error("No tiene permiso para editar turnos.");
        if (!turnoId) throw new Error("No se pudo identificar el turno.");
        const response = await window.appApi.invoke<ShiftLookupResponse>("turno:listar", {
          consulta: "turno", turnoId, usuarioId,
        });
        if (requestId !== requestIdRef.current) return;
        if (!response.ok) throw new Error(response.error.message);
        const current = response.data.turno;
        setShift(current);
        setForm({
          trabajadorId: String(current.trabajadorId), fecha: current.fecha,
          horaInicio: current.horaInicio, horaTermino: current.horaTermino,
        });
      } else {
        const response = await window.appApi.invoke<AttendanceWorkerOption[]>(
          "trabajador:listar-activos", { usuarioId, contexto: "calendario" },
        );
        if (requestId !== requestIdRef.current) return;
        if (!response.ok) throw new Error(response.error.message);
        setWorkers(response.data);
        setForm({
          ...emptyForm, fecha: initialContext.fecha,
          trabajadorId: getActivePreselectedWorkerId(response.data, initialContext.trabajadorId),
        });
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(error instanceof Error ? error.message : "No fue posible comunicarse con el proceso principal.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [editing, turnoId, role, usuarioId, initialContext]);

  useEffect(() => {
    void loadForm();
    return () => {
      requestIdRef.current += 1;
      clearTimeout(returnTimerRef.current);
    };
  }, [loadForm]);

  async function submit(): Promise<void> {
    if (savingRef.current || loading || loadError || blocked || completed) return;
    const payload = editing
      ? normalizeShiftEditPayload({ ...form, turnoId, usuarioId })
      : normalizeShiftCreatePayload({ ...form, usuarioId });
    const errors = editing ? validateShiftEditPayload(normalizeShiftEditPayload(payload)) : {};
    setFieldErrors(errors);
    setMessage(null);
    if (Object.keys(errors).length > 0) return;
    savingRef.current = true;
    setSaving(true);
    const requestId = requestIdRef.current;
    try {
      const response = await window.appApi.invoke<ShiftMutationResponse>(
        editing ? "turno:editar" : "turno:crear", payload,
      );
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        setFieldErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }
      setCompleted(true);
      if (editing) {
        const path = buildShiftCalendarPath({
          ...returnContext, inicioSemana: getWeekStartForDateKey(displayDateToIso(form.fecha)!),
        });
        if (onEditSaved) onEditSaved(path);
        else onNavigate(path);
      } else {
        setMessage("Turno creado correctamente.");
        returnTimerRef.current = setTimeout(() => onNavigate("/app/personal/turnos"), 700);
      }
    } catch {
      if (requestId === requestIdRef.current) setMessage("No fue posible comunicarse con el proceso principal.");
    } finally {
      if (requestId === requestIdRef.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            {editing ? "Editar turno" : "Crear turno"}
          </h3>
          <p className="mt-2 text-sm text-[#61717f]">
            {editing ? "Modifique la fecha y el horario del turno seleccionado." : "Desde Turnos: accion Crear turno."}
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          disabled={saving || completed}
          onClick={() => onNavigate(returnPath)}
        >
          Volver a turnos
        </button>
      </div>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loading ? (
          <p className="font-semibold text-[#244d61]">
            {editing ? "Cargando turno..." : "Cargando trabajadores activos..."}
          </p>
        ) : null}

        {!loading && loadError ? (
          <div className="grid gap-4" aria-live="assertive">
            <p className="text-sm font-semibold text-[#8f2727]" role="alert">{loadError}</p>
            <button
              className="w-fit rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => void loadForm()}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <form
            className="grid max-w-3xl gap-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {blocked ? (
              <p role="alert" className="rounded-md border border-[#e3ad72] bg-[#fff8ed] p-4 text-sm text-[#6b4a24]">
                Este turno ya inicio o tiene asistencia registrada. No puede modificarse.
              </p>
            ) : null}
            <fieldset className="grid gap-5" disabled={saving || completed || blocked}>
            {editing ? (
              <p className="font-semibold text-[#24313d]">Trabajador: {shift?.trabajadorNombre}</p>
            ) : <Field label="Trabajador activo" error={fieldErrors.trabajadorId}>
              <select
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={form.trabajadorId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    trabajadorId: event.target.value,
                  }))
                }
              >
                <option value="">Seleccione trabajador</option>
                {workers.map((worker) => (
                  <option key={worker.trabajadorId} value={worker.trabajadorId}>
                    {worker.nombreCompleto} - {worker.rut}
                  </option>
                ))}
              </select>
            </Field>}

            <div className="grid gap-5 md:grid-cols-3">
              <Field label="Fecha (DD/MM/AAAA)" error={fieldErrors.fecha}>
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  inputMode="numeric"
                  placeholder="DD/MM/AAAA"
                  value={form.fecha}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fecha: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Hora inicio (HH:MM)" error={fieldErrors.horaInicio}>
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  placeholder="HH:MM"
                  value={form.horaInicio}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      horaInicio: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label="Hora termino (HH:MM)"
                error={fieldErrors.horaTermino}
              >
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  placeholder="HH:MM"
                  value={form.horaTermino}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      horaTermino: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            </fieldset>

            <p className="rounded-md bg-[#f6f7f9] px-4 py-3 text-sm text-[#61717f]">
              El turno debe comenzar y terminar el mismo dia. Para una jornada
              que cruce medianoche se deben registrar dos turnos.
            </p>

            {message ? (
              <p
                className="rounded-md border border-[#d7dee6] bg-[#f8fafb] px-4 py-3 text-sm font-semibold text-[#24313d]"
                role="status"
              >
                {message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                disabled={saving || completed || blocked || (!editing && workers.length === 0)}
                type="submit"
              >
                {saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar turno"}
              </button>
              <button
                className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                disabled={saving || completed}
                type="button"
                onClick={() => onNavigate(returnPath)}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : null}
      </article>
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
      {error ? (
        <span className="text-xs font-semibold text-[#9f2d20]">{error}</span>
      ) : null}
    </label>
  );
}
