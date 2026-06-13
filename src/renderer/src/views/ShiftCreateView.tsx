import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AttendanceWorkerOption } from '../../../shared/attendance';
import {
  displayDateToIso,
  normalizeShiftCreatePayload,
  validateShiftCreatePayload,
  type ShiftFieldErrors,
  type ShiftMutationResponse,
} from '../../../shared/shifts';

type ShiftCreateViewProps = {
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
  trabajadorId: '',
  fecha: '',
  horaInicio: '',
  horaTermino: '',
};

export type ShiftCreateContext = {
  fecha: string;
  trabajadorId?: number;
};

export function getShiftCreateContext(path: string): ShiftCreateContext {
  const [, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  const fecha = params.get('fecha')?.trim() ?? '';
  const trabajadorIdText = params.get('trabajadorId')?.trim() ?? '';
  const trabajadorId = Number(trabajadorIdText);

  return {
    fecha: displayDateToIso(fecha) ? fecha : '',
    trabajadorId:
      trabajadorIdText &&
      Number.isInteger(trabajadorId) &&
      trabajadorId > 0
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
    : '';
}

export function ShiftCreateView({
  currentPath,
  onNavigate,
  usuarioId,
}: ShiftCreateViewProps): ReactElement {
  const initialContext = useMemo(
    () => getShiftCreateContext(currentPath),
    [currentPath],
  );
  const [form, setForm] = useState<FormState>(() => ({
    ...emptyForm,
    fecha: initialContext.fecha,
  }));
  const [workers, setWorkers] = useState<AttendanceWorkerOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<ShiftFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      fecha: initialContext.fecha,
    }));
  }, [initialContext.fecha]);

  async function loadWorkers(): Promise<void> {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await window.appApi.invoke<AttendanceWorkerOption[]>(
        'trabajador:listar-activos',
        { usuarioId },
      );

      if (!response.ok) {
        setLoadError(response.error.message);
        setWorkers([]);
        return;
      }

      setWorkers(response.data);
      setForm((current) => ({
        ...current,
        trabajadorId: getActivePreselectedWorkerId(
          response.data,
          initialContext.trabajadorId,
        ),
      }));
    } catch {
      setLoadError('No fue posible comunicarse con el proceso principal.');
      setWorkers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkers();
  }, [initialContext.trabajadorId, usuarioId]);

  const payload = useMemo(
    () =>
      normalizeShiftCreatePayload({
        ...form,
        usuarioId,
      }),
    [form, usuarioId],
  );

  async function submit(): Promise<void> {
    const errors = validateShiftCreatePayload(payload);
    setFieldErrors(errors);
    setMessage(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSaving(true);

    try {
      const response = await window.appApi.invoke<ShiftMutationResponse>(
        'turno:crear',
        payload,
      );

      if (!response.ok) {
        setFieldErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      setMessage('Turno creado correctamente.');
      window.setTimeout(() => onNavigate('/app/personal/turnos'), 700);
    } catch {
      setMessage('No fue posible comunicarse con el proceso principal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            Crear turno
          </h3>
          <p className="mt-2 text-sm text-[#61717f]">
            Desde Turnos: accion Crear turno.
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate('/app/personal/turnos')}
        >
          Volver a turnos
        </button>
      </div>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loading ? (
          <p className="font-semibold text-[#244d61]">
            Cargando trabajadores activos...
          </p>
        ) : null}

        {!loading && loadError ? (
          <div className="grid gap-4" aria-live="assertive">
            <p className="text-sm font-semibold text-[#8f2727]">{loadError}</p>
            <button
              className="w-fit rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => void loadWorkers()}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <form
            className="grid max-w-3xl gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Trabajador activo" error={fieldErrors.trabajadorId}>
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
            </Field>

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
                disabled={saving || workers.length === 0}
                type="submit"
              >
                {saving ? 'Guardando...' : 'Guardar turno'}
              </button>
              <button
                className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                disabled={saving}
                type="button"
                onClick={() => onNavigate('/app/personal/turnos')}
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
