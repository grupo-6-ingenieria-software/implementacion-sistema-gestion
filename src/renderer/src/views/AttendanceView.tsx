import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  AttendanceEntryResult,
  AttendanceExitResult,
  AttendanceWorkerOption,
} from '../../../shared/attendance';
import type { Role } from '../../../shared/navigation';
import { normalizeRut } from '../../../shared/attendance';

type AttendanceViewProps = {
  role: Role;
  usuarioId?: string;
};

type Mode = 'entrada' | 'salida';

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

type PendingNoShift = {
  message: string;
  trabajadorRut: string;
  trabajadorNombre: string;
};

export function AttendanceView({
  role,
  usuarioId,
}: AttendanceViewProps): ReactElement {
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [workers, setWorkers] = useState<AttendanceWorkerOption[]>([]);
  const [mode, setMode] = useState<Mode>('entrada');
  const [rut, setRut] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'success' | 'warning'>(
    'success',
  );
  const [pendingNoShift, setPendingNoShift] = useState<PendingNoShift | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadWorkers = useCallback(async (): Promise<void> => {
    if (!usuarioId?.trim()) {
      setPageState({
        status: 'error',
        message: 'Se requiere una sesion valida para registrar asistencia.',
      });
      return;
    }

    setPageState({ status: 'loading' });

    const response = await window.appApi.invoke<AttendanceWorkerOption[]>(
      'trabajador:listar-activos',
      { usuarioId },
    );

    if (!response.ok) {
      setPageState({ status: 'error', message: response.error.message });
      return;
    }

    setWorkers(response.data);

    if (role === 'trabajador' && response.data[0]) {
      setRut(response.data[0].rut);
    }

    setPageState({ status: 'ready' });
  }, [role, usuarioId]);

  useEffect(() => {
    void loadWorkers();
  }, [loadWorkers]);

  const filteredWorkers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es');

    if (!normalizedSearch) {
      return workers;
    }

    return workers.filter(
      (worker) =>
        worker.rut.includes(normalizedSearch) ||
        worker.nombreCompleto
          .toLocaleLowerCase('es')
          .includes(normalizedSearch),
    );
  }, [search, workers]);

  const selectedWorker = workers.find(
    (worker) => worker.rut === normalizeRut(rut),
  );
  const canSubmit = Boolean(usuarioId?.trim() && rut.trim()) && !isSubmitting;

  async function submit(): Promise<void> {
    if (!usuarioId?.trim()) {
      showMessage('error', 'Se requiere una sesion valida para registrar asistencia.');
      return;
    }

    const trabajadorRut = normalizeRut(rut);

    if (!trabajadorRut) {
      showMessage('error', 'Seleccione o ingrese un trabajador.');
      return;
    }

    setIsSubmitting(true);
    setPendingNoShift(null);
    setMessage(null);

    if (mode === 'entrada') {
      const response = await window.appApi.invoke<AttendanceEntryResult>(
        'asistencia:entrada',
        { usuarioId, trabajadorRut },
      );

      setIsSubmitting(false);

      if (!response.ok) {
        showMessage('error', response.error.message);
        return;
      }

      handleEntryResponse(response.data);
      return;
    }

    const response = await window.appApi.invoke<AttendanceExitResult>(
      'asistencia:salida',
      {
        usuarioId,
        trabajadorRut,
      },
    );

    setIsSubmitting(false);

    if (!response.ok) {
      showMessage('error', response.error.message);
      return;
    }

    showMessage(
      'success',
      `Salida registrada a las ${formatTime(response.data.salidaAt)}. Horas trabajadas: ${response.data.horasTrabajadas}.`,
    );
  }

  async function confirmWithoutShift(): Promise<void> {
    if (!pendingNoShift || !usuarioId?.trim()) {
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    const response = await window.appApi.invoke<AttendanceEntryResult>(
      'asistencia:entrada-sin-turno',
      {
        usuarioId,
        trabajadorRut: pendingNoShift.trabajadorRut,
      },
    );

    setIsSubmitting(false);
    setPendingNoShift(null);

    if (!response.ok) {
      showMessage('error', response.error.message);
      return;
    }

    if (response.data.status === 'registered') {
      showMessage(
        'success',
        `Entrada registrada a las ${formatTime(response.data.entradaAt)}.`,
      );
    }
  }

  function cancelWithoutShift(): void {
    setPendingNoShift(null);
    showMessage('warning', 'Registro cancelado. No se registro la entrada.');
  }

  function handleEntryResponse(result: AttendanceEntryResult): void {
    if (result.status === 'requires_no_shift_confirmation') {
      setPendingNoShift({
        message: result.message,
        trabajadorRut: result.trabajador.rut,
        trabajadorNombre: result.trabajador.nombreCompleto,
      });
      showMessage('warning', result.message);
      return;
    }

    showMessage(
      'success',
      `Entrada registrada a las ${formatTime(result.entradaAt)}.`,
    );
  }

  function selectWorker(worker: AttendanceWorkerOption): void {
    setRut(worker.rut);
    setSearch('');
    setMessage(null);
    setPendingNoShift(null);
  }

  function showMessage(
    tone: 'error' | 'success' | 'warning',
    nextMessage: string,
  ): void {
    setMessageTone(tone);
    setMessage(nextMessage);
  }

  if (pageState.status === 'loading') {
    return (
      <section className="px-8 py-8" aria-live="polite">
        <div className="rounded-md border border-[#cbd5df] bg-white p-8 shadow-sm">
          <p className="font-semibold text-[#244d61]">
            Cargando asistencia...
          </p>
        </div>
      </section>
    );
  }

  if (pageState.status === 'error') {
    return (
      <section className="px-8 py-8" aria-live="assertive">
        <StatusMessage
          tone="error"
          title="No se pudo cargar asistencia"
          message={pageState.message}
        />
        <button
          className="mt-5 rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => void loadWorkers()}
        >
          Reintentar
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <h3 className="text-2xl font-semibold text-[#17202a]">
        Registro de asistencia
      </h3>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-6">
          <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
            <div className="grid gap-6">
              <div>
                <h4 className="text-lg font-semibold text-[#17202a]">
                  Operacion de asistencia
                </h4>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ModeButton
                    active={mode === 'entrada'}
                    description="Registra fecha y hora actual de entrada."
                    label="Entrada"
                    onClick={() => {
                      setMode('entrada');
                      setPendingNoShift(null);
                      setMessage(null);
                    }}
                  />
                  <ModeButton
                    active={mode === 'salida'}
                    description="Registra salida y calcula horas trabajadas."
                    label="Salida"
                    onClick={() => {
                      setMode('salida');
                      setPendingNoShift(null);
                      setMessage(null);
                    }}
                  />
                </div>
              </div>

              <div className="border-t border-[#e3e8ee] pt-6">
                <h4 className="text-lg font-semibold text-[#17202a]">
                  Trabajador
                </h4>
                <div className="mt-4">
                  {role === 'dueno' ? (
                    <OwnerWorkerPicker
                      filteredWorkers={filteredWorkers}
                      rut={rut}
                      search={search}
                      selectedWorker={selectedWorker}
                      onRutChange={(value) => {
                        setRut(value);
                        setPendingNoShift(null);
                        setMessage(null);
                      }}
                      onSearchChange={setSearch}
                      onSelectWorker={selectWorker}
                    />
                  ) : (
                    <WorkerSelfPanel worker={selectedWorker ?? workers[0]} />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-[#e3e8ee] pt-6">
                <button
                  className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                  disabled={!canSubmit || Boolean(pendingNoShift)}
                  type="button"
                  onClick={() => void submit()}
                >
                  {isSubmitting
                    ? 'Registrando...'
                    : mode === 'entrada'
                      ? 'Registrar entrada'
                      : 'Registrar salida'}
                </button>
                <button
                  className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                  disabled={isSubmitting}
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setPendingNoShift(null);
                    if (role === 'dueno') {
                      setRut('');
                    }
                  }}
                >
                  Limpiar
                </button>
              </div>
            </div>
          </article>

          {pendingNoShift ? (
            <NoShiftConfirmation
              isSubmitting={isSubmitting}
              pendingNoShift={pendingNoShift}
              onCancel={cancelWithoutShift}
              onConfirm={() => void confirmWithoutShift()}
            />
          ) : null}

          {message ? (
            <StatusMessage
              tone={messageTone}
              title={getMessageTitle(messageTone)}
              message={message}
            />
          ) : null}
        </div>

        <aside className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm self-start">
          <h4 className="text-lg font-semibold text-[#17202a]">
            Trabajador seleccionado
          </h4>
          {selectedWorker ? (
            <dl className="mt-5 grid gap-4 text-sm">
              <Info label="Nombre" value={selectedWorker.nombreCompleto} />
              <Info label="RUT" value={selectedWorker.rut} />
              <Info
                label="Operacion"
                value={mode === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}
              />
            </dl>
          ) : rut.trim() ? (
            <dl className="mt-5 grid gap-4 text-sm">
              <Info label="RUT ingresado" value={normalizeRut(rut)} />
              <Info
                label="Operacion"
                value={mode === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}
              />
            </dl>
          ) : (
            <p className="mt-4 rounded-md bg-[#f6f7f9] px-3 py-3 text-sm font-semibold text-[#61717f]">
              Seleccione un trabajador activo o ingrese su RUT.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  description,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className={`rounded-md border px-4 py-4 text-left transition ${
        active
          ? 'border-[#244d61] bg-[#eef6f2] text-[#17202a] shadow-sm'
          : 'border-[#d7dee6] bg-white text-[#61717f] hover:border-[#9ba9b5] hover:text-[#17202a]'
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-1 block text-xs font-medium">{description}</span>
    </button>
  );
}

function OwnerWorkerPicker({
  filteredWorkers,
  onRutChange,
  onSearchChange,
  onSelectWorker,
  rut,
  search,
  selectedWorker,
}: {
  filteredWorkers: AttendanceWorkerOption[];
  onRutChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectWorker: (worker: AttendanceWorkerOption) => void;
  rut: string;
  search: string;
  selectedWorker?: AttendanceWorkerOption;
}): ReactElement {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
      <div className="self-start rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
        <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
          RUT del trabajador
          <input
            className="w-full rounded-md border border-[#9ba9b5] bg-white px-3 py-2 font-normal"
            placeholder="12345678-9"
            value={rut}
            onChange={(event) => onRutChange(event.target.value)}
          />
        </label>
        <p className="mt-3 text-xs font-medium text-[#61717f]">
          Puede ingresar el RUT directamente o seleccionar un trabajador activo.
        </p>
      </div>

      <div className="grid gap-2 rounded-md border border-[#d7dee6] bg-white p-4">
        <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
          Buscar trabajador activo
          <input
            className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
            placeholder="Nombre o RUT"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <div className="max-h-64 overflow-y-auto rounded-md border border-[#d7dee6]">
          {filteredWorkers.map((worker) => (
            <button
              className={`grid w-full gap-1 border-t border-[#edf1f5] px-4 py-3 text-left first:border-t-0 transition hover:bg-[#f6f7f9] ${
                selectedWorker?.rut === worker.rut ? 'bg-[#e8f3ed]' : 'bg-white'
              }`}
              key={worker.trabajadorId}
              type="button"
              onClick={() => onSelectWorker(worker)}
            >
              <span className="text-sm font-semibold text-[#17202a]">
                {worker.nombreCompleto}
              </span>
              <span className="text-xs text-[#61717f]">{worker.rut}</span>
            </button>
          ))}
          {filteredWorkers.length === 0 ? (
            <p className="px-4 py-3 text-sm font-semibold text-[#61717f]">
              No hay trabajadores activos para esa busqueda.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkerSelfPanel({
  worker,
}: {
  worker?: AttendanceWorkerOption;
}): ReactElement {
  if (!worker) {
    return (
      <p className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727]">
        No se encontro un trabajador activo asociado a la sesion.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
      <p className="text-sm font-semibold text-[#61717f]">
        Asistencia propia
      </p>
      <p className="mt-2 text-lg font-semibold text-[#17202a]">
        {worker.nombreCompleto}
      </p>
      <p className="mt-1 text-sm text-[#61717f]">{worker.rut}</p>
    </div>
  );
}

function NoShiftConfirmation({
  isSubmitting,
  onCancel,
  onConfirm,
  pendingNoShift,
}: {
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pendingNoShift: PendingNoShift;
}): ReactElement {
  return (
    <section className="rounded-md border border-[#e3ad72] bg-[#fff8ed] p-5 shadow-sm">
      <p className="text-sm font-semibold uppercase text-[#9a5a16]">
        Confirmacion requerida
      </p>
      <h4 className="mt-1 text-lg font-semibold text-[#7a3f0c]">
        Trabajador sin turno asignado
      </h4>
      <p className="mt-2 text-sm text-[#6b4a24]">
        {pendingNoShift.trabajadorNombre} no tiene turno para hoy. El registro de
        entrada solo se guardara si confirma esta advertencia.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="rounded-md border border-[#9ba9b5] bg-white px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          disabled={isSubmitting}
          type="button"
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
          disabled={isSubmitting}
          type="button"
          onClick={onConfirm}
        >
          Confirmar entrada
        </button>
      </div>
    </section>
  );
}

function StatusMessage({
  message,
  title,
  tone,
}: {
  message: string;
  title: string;
  tone: 'error' | 'success' | 'warning';
}): ReactElement {
  const styles = {
    error: 'border-[#dba7a7] bg-[#fff7f7] text-[#8f2727]',
    success: 'border-[#a9cfb9] bg-[#f2faf5] text-[#22583f]',
    warning: 'border-[#e3ad72] bg-[#fff8ed] text-[#7a3f0c]',
  };

  return (
    <div className={`rounded-md border p-4 ${styles[tone]}`} role="status">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#61717f]">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-[#24313d]">{value}</dd>
    </div>
  );
}

function getMessageTitle(tone: 'error' | 'success' | 'warning'): string {
  if (tone === 'error') {
    return 'No se pudo registrar';
  }

  if (tone === 'warning') {
    return 'Atencion';
  }

  return 'Registro completado';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
