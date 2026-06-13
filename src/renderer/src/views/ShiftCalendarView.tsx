import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { AttendanceWorkerOption } from '../../../shared/attendance';
import {
  addDaysToDateKey,
  getWeekStartDateKey,
  isoDateToDisplay,
  normalizeShiftEditPayload,
  validateShiftEditPayload,
  type ShiftCalendarItem,
  type ShiftFieldErrors,
  type ShiftListResponse,
  type ShiftMutationResponse,
} from '../../../shared/shifts';

type ShiftCalendarViewProps = {
  onNavigate: (path: string) => void;
  usuarioId: string;
};

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ShiftListResponse; refreshing: boolean };

type EditForm = {
  fecha: string;
  horaInicio: string;
  horaTermino: string;
};

type CalendarInvoke = typeof window.appApi.invoke;

export async function loadShiftCalendarData(
  invoke: CalendarInvoke,
  input: {
    usuarioId: string;
    inicioSemana: string;
    trabajadorId?: number;
  },
): Promise<{
  workers: AttendanceWorkerOption[];
  shifts: ShiftListResponse;
}> {
  const [workersResponse, shiftsResponse] = await Promise.all([
    invoke<AttendanceWorkerOption[]>('trabajador:listar-activos', {
      usuarioId: input.usuarioId,
    }),
    invoke<ShiftListResponse>('turno:listar', {
      usuarioId: input.usuarioId,
      inicioSemana: input.inicioSemana,
      trabajadorId: input.trabajadorId,
    }),
  ]);

  if (!workersResponse.ok) {
    throw new Error(workersResponse.error.message);
  }

  if (!shiftsResponse.ok) {
    throw new Error(shiftsResponse.error.message);
  }

  return {
    workers: workersResponse.data,
    shifts: shiftsResponse.data,
  };
}

export type ShiftResultEvent =
  | 'edit-success'
  | 'delete-success'
  | 'start-operation';

export function getShiftResultMessage(event: ShiftResultEvent): string | null {
  if (event === 'edit-success') {
    return 'Turno actualizado correctamente.';
  }

  if (event === 'delete-success') {
    return 'Turno eliminado correctamente.';
  }

  return null;
}

export function buildShiftCreatePath(
  dateKey: string,
  trabajadorId?: number,
): string {
  const params = new URLSearchParams({
    fecha: isoDateToDisplay(dateKey),
  });

  if (trabajadorId && Number.isInteger(trabajadorId) && trabajadorId > 0) {
    params.set('trabajadorId', String(trabajadorId));
  }

  return `/app/personal/turnos/nuevo?${params.toString()}`;
}

export function isLatestShiftCalendarRequest(
  requestId: number,
  latestRequestId: number,
): boolean {
  return requestId === latestRequestId;
}

const dayNames = [
  'Lunes',
  'Martes',
  'Miercoles',
  'Jueves',
  'Viernes',
  'Sabado',
  'Domingo',
];

export function ShiftCalendarView({
  onNavigate,
  usuarioId,
}: ShiftCalendarViewProps): ReactElement {
  const [weekStart, setWeekStart] = useState(getWeekStartDateKey);
  const [workerFilter, setWorkerFilter] = useState('');
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [workers, setWorkers] = useState<AttendanceWorkerOption[]>([]);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [selected, setSelected] = useState<ShiftCalendarItem | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ShiftFieldErrors>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestIdRef = useRef(0);

  const loadCalendar = useCallback(
    async (preserveData = false): Promise<void> => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState((current) =>
        preserveData && current.status === 'ready'
          ? { ...current, refreshing: true }
          : { status: 'loading' },
      );

      try {
        const data = await loadShiftCalendarData(window.appApi.invoke, {
          usuarioId,
          inicioSemana: weekStart,
          trabajadorId: workerFilter ? Number(workerFilter) : undefined,
        });

        if (!isLatestShiftCalendarRequest(requestId, requestIdRef.current)) {
          return;
        }

        setWorkers(data.workers);
        setState({ status: 'ready', data: data.shifts, refreshing: false });
      } catch (error) {
        if (!isLatestShiftCalendarRequest(requestId, requestIdRef.current)) {
          return;
        }

        setState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'No fue posible comunicarse con el proceso principal.',
        });
      }
    },
    [usuarioId, weekStart, workerFilter],
  );

  useEffect(() => {
    setSelected(null);
    setSelectedDateKey(null);
    setEditForm(null);
    setActionMessage(null);
    void loadCalendar();
  }, [loadCalendar]);

  const weekDays = useMemo(
    () =>
      dayNames.map((name, index) => ({
        name,
        dateKey: addDaysToDateKey(weekStart, index),
      })),
    [weekStart],
  );

  function selectShift(turno: ShiftCalendarItem): void {
    setSelectedDateKey(turno.fechaIso);
    setSelected(turno);
    setEditForm(
      turno.puedeModificar
        ? {
            fecha: turno.fecha,
            horaInicio: turno.horaInicio,
            horaTermino: turno.horaTermino,
          }
        : null,
    );
    setFieldErrors({});
    setActionMessage(null);
    setResultMessage(getShiftResultMessage('start-operation'));
    setDeleting(false);
  }

  async function saveEdit(): Promise<void> {
    if (!selected || !editForm) {
      return;
    }

    const payload = normalizeShiftEditPayload({
      ...editForm,
      turnoId: selected.turnoId,
      usuarioId,
    });
    const errors = validateShiftEditPayload(payload);
    setFieldErrors(errors);
    setActionMessage(null);
    setResultMessage(getShiftResultMessage('start-operation'));

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSaving(true);

    try {
      const response = await window.appApi.invoke<ShiftMutationResponse>(
        'turno:editar',
        payload,
      );

      if (!response.ok) {
        setFieldErrors(response.error.fieldErrors ?? {});
        setActionMessage(response.error.message);
        return;
      }

      setSelected(null);
      setEditForm(null);
      setResultMessage(getShiftResultMessage('edit-success'));
      await loadCalendar(true);
    } catch {
      setActionMessage('No fue posible comunicarse con el proceso principal.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!selected) {
      return;
    }

    setSaving(true);
    setActionMessage(null);
    setResultMessage(getShiftResultMessage('start-operation'));

    try {
      const response = await window.appApi.invoke<ShiftMutationResponse>(
        'turno:eliminar',
        {
          turnoId: selected.turnoId,
          confirmacion: true,
          usuarioId,
        },
      );

      if (!response.ok) {
        setActionMessage(response.error.message);
        setDeleting(false);
        return;
      }

      setSelected(null);
      setEditForm(null);
      setDeleting(false);
      setResultMessage(getShiftResultMessage('delete-success'));
      await loadCalendar(true);
    } catch {
      setActionMessage('No fue posible comunicarse con el proceso principal.');
    } finally {
      setSaving(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <section className="px-8 py-8" aria-live="polite">
        <div className="rounded-md border border-[#cbd5df] bg-white p-8 shadow-sm">
          <p className="font-semibold text-[#244d61]">
            Cargando calendario de turnos...
          </p>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="px-8 py-8" aria-live="assertive">
        <div className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[#8f2727]">
            No se pudo cargar el calendario
          </h3>
          <p className="mt-2 text-sm text-[#6f3333]">{state.message}</p>
          <button
            className="mt-5 rounded-md border border-[#9ba9b5] bg-white px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => void loadCalendar()}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            Calendario semanal de turnos
          </h3>
          <p className="mt-2 text-sm text-[#61717f]">
            Semana del {isoDateToDisplay(state.data.inicioSemana)} al{' '}
            {isoDateToDisplay(state.data.finSemana)}.
          </p>
        </div>
        <div className="grid justify-items-end gap-2">
          <button
            className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
            disabled={!selectedDateKey}
            type="button"
            onClick={() => {
              if (!selectedDateKey) {
                return;
              }

              onNavigate(
                buildShiftCreatePath(
                  selectedDateKey,
                  workerFilter ? Number(workerFilter) : undefined,
                ),
              );
            }}
          >
            Crear turno
          </button>
          <p className="text-xs text-[#61717f]">
            {selectedDateKey
              ? `Fecha seleccionada: ${isoDateToDisplay(selectedDateKey)}`
              : 'Seleccione un dia del calendario.'}
          </p>
        </div>
      </div>

      <article className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => setWeekStart(addDaysToDateKey(weekStart, -7))}
            >
              Semana anterior
            </button>
            <button
              className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => setWeekStart(addDaysToDateKey(weekStart, 7))}
            >
              Semana siguiente
            </button>
          </div>
          <label className="grid min-w-64 gap-2 text-sm font-semibold text-[#24313d]">
            Filtrar por trabajador
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={workerFilter}
              onChange={(event) => setWorkerFilter(event.target.value)}
            >
              <option value="">Todos los trabajadores activos</option>
              {workers.map((worker) => (
                <option key={worker.trabajadorId} value={worker.trabajadorId}>
                  {worker.nombreCompleto}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>

      {state.refreshing ? (
        <p className="text-sm font-semibold text-[#61717f]" role="status">
          Actualizando calendario...
        </p>
      ) : null}

      {resultMessage ? (
        <p
          className="rounded-md border border-[#9bc6ad] bg-[#eef8f1] px-4 py-3 text-sm font-semibold text-[#255a43]"
          role="status"
        >
          {resultMessage}
        </p>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-7">
        {weekDays.map((day) => {
          const dayShifts = state.data.turnos.filter(
            (turno) => turno.fechaIso === day.dateKey,
          );

          return (
            <article
              className={`min-h-44 rounded-md border bg-white p-3 shadow-sm ${
                selectedDateKey === day.dateKey
                  ? 'border-[#2d6a4f] ring-2 ring-[#b7d8c5]'
                  : 'border-[#cbd5df]'
              }`}
              key={day.dateKey}
            >
              <button
                className="w-full rounded-md px-1 py-1 text-left transition hover:bg-[#eef4f1]"
                type="button"
                onClick={() => setSelectedDateKey(day.dateKey)}
              >
                <span className="block font-semibold text-[#17202a]">
                  {day.name}
                </span>
                <span className="mt-1 block text-xs text-[#61717f]">
                  {isoDateToDisplay(day.dateKey)}
                </span>
              </button>
              <div className="mt-4 grid gap-2">
                {dayShifts.map((turno) => (
                  <button
                    className={`rounded-md border p-3 text-left transition hover:bg-[#eef4f1] ${
                      selected?.turnoId === turno.turnoId
                        ? 'border-[#2d6a4f] bg-[#e8f3ed]'
                        : 'border-[#d7dee6] bg-[#f8fafb]'
                    }`}
                    key={turno.turnoId}
                    type="button"
                    onClick={() => selectShift(turno)}
                  >
                    <span className="block text-sm font-semibold text-[#17202a]">
                      {turno.trabajadorNombre}
                    </span>
                    <span className="mt-1 block text-xs text-[#61717f]">
                      {turno.horaInicio} - {turno.horaTermino}
                    </span>
                  </button>
                ))}
                {dayShifts.length === 0 ? (
                  <p className="rounded-md bg-[#f6f7f9] px-3 py-3 text-xs text-[#61717f]">
                    Sin turnos
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {selected ? (
        <ShiftDetail
          deleting={deleting}
          editForm={editForm}
          fieldErrors={fieldErrors}
          message={actionMessage}
          saving={saving}
          shift={selected}
          onCancel={() => {
            setSelected(null);
            setEditForm(null);
            setDeleting(false);
            setActionMessage(null);
          }}
          onConfirmDelete={() => void confirmDelete()}
          onDelete={() => {
            setResultMessage(getShiftResultMessage('start-operation'));
            setDeleting(true);
          }}
          onEditChange={setEditForm}
          onSave={() => void saveEdit()}
        />
      ) : null}
    </section>
  );
}

function ShiftDetail({
  deleting,
  editForm,
  fieldErrors,
  message,
  saving,
  shift,
  onCancel,
  onConfirmDelete,
  onDelete,
  onEditChange,
  onSave,
}: {
  deleting: boolean;
  editForm: EditForm | null;
  fieldErrors: ShiftFieldErrors;
  message: string | null;
  saving: boolean;
  shift: ShiftCalendarItem;
  onCancel: () => void;
  onConfirmDelete: () => void;
  onDelete: () => void;
  onEditChange: (form: EditForm) => void;
  onSave: () => void;
}): ReactElement {
  return (
    <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold text-[#17202a]">
            {shift.trabajadorNombre}
          </h4>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={onCancel}
        >
          Cerrar
        </button>
      </div>

      {!shift.puedeModificar || !editForm ? (
        <div className="mt-5 rounded-md border border-[#e3ad72] bg-[#fff8ed] p-4 text-sm text-[#6b4a24]">
          Este turno ya inicio o tiene asistencia registrada. No puede
          modificarse ni eliminarse.
        </div>
      ) : (
        <div className="mt-5 grid gap-5">
          <div className="grid gap-5 md:grid-cols-3">
            <Field label="Fecha (DD/MM/AAAA)" error={fieldErrors.fecha}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={editForm.fecha}
                onChange={(event) =>
                  onEditChange({ ...editForm, fecha: event.target.value })
                }
              />
            </Field>
            <Field label="Hora inicio (HH:MM)" error={fieldErrors.horaInicio}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={editForm.horaInicio}
                onChange={(event) =>
                  onEditChange({ ...editForm, horaInicio: event.target.value })
                }
              />
            </Field>
            <Field label="Hora termino (HH:MM)" error={fieldErrors.horaTermino}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={editForm.horaTermino}
                onChange={(event) =>
                  onEditChange({ ...editForm, horaTermino: event.target.value })
                }
              />
            </Field>
          </div>

          {message ? (
            <p className="rounded-md border border-[#dba7a7] bg-[#fff7f7] px-4 py-3 text-sm font-semibold text-[#8f2727]">
              {message}
            </p>
          ) : null}

          {deleting ? (
            <div className="rounded-md border border-[#e3ad72] bg-[#fff8ed] p-4">
              <p className="font-semibold text-[#7a3f0c]">
                Confirma la eliminacion del turno
              </p>
              <p className="mt-2 text-sm text-[#6b4a24]">
                {shift.trabajadorNombre}, {shift.fecha}, de {shift.horaInicio} a{' '}
                {shift.horaTermino}.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="rounded-md border border-[#9ba9b5] bg-white px-4 py-2 text-sm font-semibold text-[#24313d]"
                  disabled={saving}
                  type="button"
                  onClick={onCancel}
                >
                  Cancelar
                </button>
                <button
                  className="rounded-md bg-[#8a3b2d] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#c9a59d]"
                  disabled={saving}
                  type="button"
                  onClick={onConfirmDelete}
                >
                  {saving ? 'Eliminando...' : 'Confirmar eliminacion'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:bg-[#9ba9b5]"
                disabled={saving}
                type="button"
                onClick={onSave}
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button
                className="rounded-md border border-[#b66a60] px-4 py-2 text-sm font-semibold text-[#8a3b2d] transition hover:bg-[#fff3f1]"
                disabled={saving}
                type="button"
                onClick={onDelete}
              >
                Eliminar turno
              </button>
            </div>
          )}
        </div>
      )}
    </article>
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
