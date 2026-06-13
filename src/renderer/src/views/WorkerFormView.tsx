import { useMemo, useState, type ReactElement } from 'react';
import {
  emptyWorkerForm,
  normalizeWorkerFormValues,
  roleLabel,
  validateWorkerFormValues,
  type WorkerCreateResponse,
  type WorkerFieldErrors,
  type WorkerFormValues,
} from '../../../shared/workers';

type WorkerFormViewProps = {
  usuarioId: string;
  onNavigate: (path: string) => void;
};

export function WorkerFormView({
  onNavigate,
  usuarioId,
}: WorkerFormViewProps): ReactElement {
  const [form, setForm] = useState<WorkerFormValues>(emptyWorkerForm);
  const [fieldErrors, setFieldErrors] = useState<WorkerFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<WorkerCreateResponse | null>(null);

  const parsedValues = useMemo(() => normalizeWorkerFormValues(form), [form]);

  async function handleSubmit(): Promise<void> {
    const errors = validateWorkerFormValues(parsedValues);
    setFieldErrors(errors);
    setMessage(null);
    setCreated(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSaving(true);

    const response = await window.appApi.invoke<WorkerCreateResponse>(
      'trabajador:registrar',
      {
        ...parsedValues,
        usuarioId,
      },
    );

    setSaving(false);

    if (!response.ok) {
      setFieldErrors(response.error.fieldErrors ?? {});
      setMessage(response.error.message);
      return;
    }

    setForm(emptyWorkerForm);
    setFieldErrors({});
    setCreated(response.data);
    setMessage('Trabajador registrado correctamente.');
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            Registrar trabajador
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-[#61717f]">
            Ingresa los datos del trabajador. La cuenta de acceso se crea con
            el RUT y una contrasena temporal.
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate('/app/personal/trabajadores')}
        >
          Volver a trabajadores
        </button>
      </div>

      <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="RUT" error={fieldErrors.rut}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                placeholder="12345678-9"
                value={form.rut}
                onChange={(event) =>
                  setForm((current) => ({ ...current, rut: event.target.value }))
                }
              />
            </Field>

            <Field label="Nombre completo" error={fieldErrors.nombreCompleto}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                maxLength={100}
                value={form.nombreCompleto}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    nombreCompleto: event.target.value,
                  }))
                }
              />
            </Field>

            <Field label="Rol de sistema" error={fieldErrors.rol}>
              <select
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                value={form.rol}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    rol: event.target.value === 'dueno' ? 'dueno' : 'trabajador',
                  }))
                }
              >
                <option value="trabajador">{roleLabel('trabajador')}</option>
                <option value="dueno">{roleLabel('dueno')}</option>
              </select>
            </Field>

            <Field label="Telefono" error={fieldErrors.telefono}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                inputMode="numeric"
                maxLength={9}
                placeholder="987654321"
                value={form.telefono}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    telefono: event.target.value.replace(/\D/g, ''),
                  }))
                }
              />
            </Field>

            <Field label="Correo opcional" error={fieldErrors.correo}>
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                maxLength={50}
                placeholder="correo@dominio.cl"
                type="email"
                value={form.correo ?? ''}
                onChange={(event) =>
                  setForm((current) => ({ ...current, correo: event.target.value }))
                }
              />
            </Field>
          </div>

          {message ? (
            <p
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                created
                  ? 'border-[#b7dfc8] bg-[#effaf3] text-[#2d6a4f]'
                  : 'border-[#fecdca] bg-[#fff3f1] text-[#b42318]'
              }`}
            >
              {message}
            </p>
          ) : null}

          {created ? (
            <section className="rounded-md border border-[#cbd5df] bg-[#f8fafb] p-5">
              <p className="text-sm font-semibold text-[#24313d]">
                Credenciales temporales
              </p>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <Info label="Usuario" value={created.credenciales.usuario} />
                <Info
                  label="Contrasena temporal"
                  value={created.credenciales.contrasenaTemporal}
                />
              </dl>
              <p className="mt-3 text-sm text-[#61717f]">
                La contrasena se muestra solo en este resultado y el trabajador
                debera cambiarla en su primer inicio de sesion.
              </p>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
            <button
              className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Guardando...' : 'Guardar trabajador'}
            </button>
            <button
              className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => onNavigate('/app/personal/trabajadores')}
            >
              Cancelar
            </button>
          </div>
        </form>
      </section>
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

function Info({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#61717f]">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-semibold text-[#17202a]">
        {value}
      </dd>
    </div>
  );
}
