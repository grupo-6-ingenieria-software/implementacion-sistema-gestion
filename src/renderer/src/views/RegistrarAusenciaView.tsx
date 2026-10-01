import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ABSENCE_OBSERVATION_LIMIT, countAbsenceObservation, validateAbsenceRequest,
  type AbsenceFieldErrors, type AbsenceResult,
} from "../../../shared/absence";
import { normalizeRut, type AttendanceWorkerOption } from "../../../shared/attendance";
import { getChileDateKey } from "../../../shared/sales";
import type { Role } from "../../../shared/navigation";

const inputClass = "w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal";
const buttonClass = "rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] disabled:opacity-50";

type Props = {
  usuarioId: string;
  role: Role;
  initialRut?: string;
  onNavigate: (path: string) => void;
  onSaved: (result: AbsenceResult) => void;
};

export function RegistrarAusenciaView({ usuarioId, role, initialRut, onNavigate, onSaved }: Props): ReactElement {
  const [workers, setWorkers] = useState<AttendanceWorkerOption[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [search, setSearch] = useState("");
  const [fecha, setFecha] = useState(() => getChileDateKey());
  const [tipo, setTipo] = useState("");
  const [observacion, setObservacion] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<AbsenceFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);
  const submitLocked = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    submitLocked.current = false;
    setSaving(false);
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    setWorkerId("");
    setErrors({});
    if (role !== "dueno") return () => { generation.current++; };
    async function load(): Promise<void> {
      try {
        const response = await window.appApi.invoke<AttendanceWorkerOption[]>("trabajador:listar-activos", { usuarioId });
        if (current !== generation.current) return;
        if (!response.ok) { setLoadError(response.error.message); setWorkers([]); return; }
        setWorkers(response.data);
        if (initialRut) {
          const selected = response.data.find((worker) => normalizeRut(worker.rut) === normalizeRut(initialRut));
          if (selected) setWorkerId(String(selected.trabajadorId));
          else setMessage("El trabajador seleccionado ya no está disponible. Seleccione otro trabajador.");
        }
      } catch {
        if (current === generation.current) {
          setWorkers([]);
          setLoadError("No fue posible cargar los trabajadores. Intente nuevamente.");
        }
      } finally {
        if (current === generation.current) setLoading(false);
      }
    }
    void load();
    return () => { generation.current++; };
  }, [usuarioId, role, initialRut, reloadKey]);

  const options = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    const rutTerm = term.replace(/[.\-\s]/g, "");
    return workers.filter((worker) => String(worker.trabajadorId) === workerId
      || worker.nombreCompleto.toLocaleLowerCase("es").includes(term)
      || worker.rut.replace(/[.\-\s]/g, "").toLowerCase().includes(rutTerm));
  }, [search, workers, workerId]);
  const count = countAbsenceObservation(observacion);
  const observationError = count > ABSENCE_OBSERVATION_LIMIT
    ? "La observación no puede superar los 200 caracteres." : errors.observacion;

  async function submit(): Promise<void> {
    if (submitLocked.current || loading || loadError || role !== "dueno") return;
    const validation = validateAbsenceRequest({ trabajadorId: Number(workerId), fecha, tipo, observacion });
    setErrors(validation.errors);
    setMessage(null);
    if (!validation.values) return;
    submitLocked.current = true;
    setSaving(true);
    const current = generation.current;
    let saved = false;
    try {
      const response = await window.appApi.invoke<AbsenceResult>("ausencia:registrar", validation.values);
      if (current !== generation.current) return;
      if (!response.ok) {
        setErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }
      // Keep the lock until navigation unmounts this successfully saved form.
      saved = true;
      onSaved(response.data);
    } catch {
      if (current === generation.current) setMessage("No fue posible confirmar el registro. Intente nuevamente.");
    } finally {
      if (current === generation.current && !saved) { submitLocked.current = false; setSaving(false); }
    }
  }

  if (role !== "dueno") return <p role="alert" className="p-8">No tiene permiso para registrar ausencias.</p>;
  return (
    <section className="px-8 py-8">
      <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
      <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">Registrar ausencia</h3>
      <p className="mt-2 text-sm text-[#61717f]">Seleccione un trabajador activo e indique la fecha y el tipo de ausencia.</p>
      {message ? <p role="alert" className="mt-4 rounded-md border border-[#fecdca] bg-[#fff3f1] p-3 text-[#b42318]">{message}</p> : null}
      {loading ? <p role="status" className="mt-6">Cargando trabajadores...</p> : loadError ? (
        <div className="mt-6"><p role="alert">{loadError}</p><button type="button" className={`${buttonClass} mt-3`} onClick={() => setReloadKey((key) => key + 1)}>Reintentar</button></div>
      ) : (
        <form noValidate className="mt-6 grid max-w-3xl gap-5 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {!workers.length ? <p role="status">No hay trabajadores activos disponibles para registrar una ausencia.</p> : null}
          <fieldset disabled={saving} className="grid gap-5">
            <label className="grid gap-2 text-sm font-semibold">Buscar trabajador por nombre o RUT
              <input aria-label="Buscar trabajador por nombre o RUT" className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">Trabajador
              <select aria-label="Trabajador" className={inputClass} value={workerId} aria-invalid={Boolean(errors.trabajadorId)} aria-describedby="absence-worker-error" onChange={(event) => { setWorkerId(event.target.value); setErrors((old) => ({ ...old, trabajadorId: undefined })); }}>
                <option value="">Seleccione un trabajador</option>
                {options.map((worker) => <option key={worker.trabajadorId} value={worker.trabajadorId}>{worker.nombreCompleto} — {worker.rut}</option>)}
              </select>
              <FieldError id="absence-worker-error" message={errors.trabajadorId} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">Fecha de ausencia
              <input aria-label="Fecha de ausencia" type="date" className={inputClass} max={getChileDateKey()} value={fecha} aria-invalid={Boolean(errors.fecha)} aria-describedby="absence-date-error" onChange={(event) => { setFecha(event.target.value); setErrors((old) => ({ ...old, fecha: undefined })); }} />
              <FieldError id="absence-date-error" message={errors.fecha} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">Tipo de ausencia
              <select aria-label="Tipo de ausencia" className={inputClass} value={tipo} aria-invalid={Boolean(errors.tipo)} aria-describedby="absence-type-error" onChange={(event) => { setTipo(event.target.value); setErrors((old) => ({ ...old, tipo: undefined })); }}>
                <option value="">Seleccione un tipo</option><option value="justificada">Justificada</option><option value="injustificada">Injustificada</option>
              </select>
              <FieldError id="absence-type-error" message={errors.tipo} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">Observación (opcional)
              <textarea aria-label="Observación (opcional)" rows={3} className={inputClass} value={observacion} aria-invalid={Boolean(observationError)} aria-describedby="absence-observation-count absence-observation-error" onChange={(event) => { setObservacion(event.target.value); setErrors((old) => ({ ...old, observacion: undefined })); }} />
              <span id="absence-observation-count" className="text-xs font-normal text-[#61717f]">{count}/{ABSENCE_OBSERVATION_LIMIT} caracteres</span>
              <FieldError id="absence-observation-error" message={observationError} />
            </label>
          </fieldset>
          <div className="flex gap-3">
            <button type="submit" disabled={saving || !workers.length || count > ABSENCE_OBSERVATION_LIMIT} className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Registrando..." : "Registrar ausencia"}</button>
            <button type="button" className={buttonClass} onClick={() => onNavigate("/app/personal/trabajadores")}>Cancelar</button>
          </div>
        </form>
      )}
      {loading || loadError ? <button type="button" className={`${buttonClass} mt-4`} onClick={() => onNavigate("/app/personal/trabajadores")}>Cancelar</button> : null}
    </section>
  );
}

function FieldError({ id, message }: { id: string; message?: string }): ReactElement {
  return <span id={id} className="text-sm font-normal text-[#b42318]">{message}</span>;
}
