import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { AttendanceWorkerOption } from "../../../shared/attendance";
import {
  DEFAULT_PREVISIONAL_RATES,
  PREVISIONAL_TIPO_LABELS,
  type PrevisionalRates,
} from "../../../shared/previsional";
import {
  MESES_LABEL,
  calculateRemuneracion,
  normalizeRemuneracionCreatePayload,
  type RemuneracionFieldErrors,
  type RemuneracionMutationResponse,
} from "../../../shared/remuneraciones";

type RegistrarRemuneracionViewProps = {
  onNavigate: (path: string) => void;
  usuarioId: string;
};

type FormState = {
  trabajadorId: string;
  mes: string;
  anio: string;
  montoBruto: string;
  observacion: string;
};

const currentDate = new Date();
const emptyForm: FormState = {
  trabajadorId: "",
  mes: String(currentDate.getMonth() + 1),
  anio: String(currentDate.getFullYear()),
  montoBruto: "",
  observacion: "",
};

export function RegistrarRemuneracionView({
  onNavigate,
  usuarioId,
}: RegistrarRemuneracionViewProps): ReactElement {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [workers, setWorkers] = useState<AttendanceWorkerOption[]>([]);
  const [rates, setRates] = useState<PrevisionalRates>(
    DEFAULT_PREVISIONAL_RATES,
  );
  const [fieldErrors, setFieldErrors] = useState<RemuneracionFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RemuneracionMutationResponse | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  async function loadFormData(): Promise<void> {
    setLoading(true);
    setLoadError(null);

    try {
      const [workersResponse, ratesResponse] = await Promise.all([
        window.appApi.invoke<AttendanceWorkerOption[]>(
          "trabajador:listar-activos",
          { usuarioId },
        ),
        window.appApi.invoke<PrevisionalRates>(
          "configuracion:previsional-obtener",
          { usuarioId },
        ),
      ]);

      if (!workersResponse.ok) {
        setLoadError(workersResponse.error.message);
        return;
      }

      if (!ratesResponse.ok) {
        setLoadError(ratesResponse.error.message);
        return;
      }

      setWorkers(workersResponse.data);
      setRates(ratesResponse.data);
    } catch {
      setLoadError("No fue posible comunicarse con el proceso principal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFormData();
  }, [usuarioId]);

  const payload = useMemo(
    () =>
      normalizeRemuneracionCreatePayload({
        ...form,
        usuarioId,
      }),
    [form, usuarioId],
  );

  const preview = useMemo(() => {
    if (!Number.isFinite(payload.montoBruto) || payload.montoBruto <= 0) {
      return null;
    }

    return calculateRemuneracion(
      payload.montoBruto,
      (Object.keys(rates) as (keyof PrevisionalRates)[]).map((tipo) => ({
        tipo,
        porcentaje: rates[tipo],
      })),
    );
  }, [payload.montoBruto, rates]);

  async function submit(): Promise<void> {
    setFieldErrors({});
    setMessage(null);
    setResult(null);
    setSaving(true);

    try {
      const response = await window.appApi.invoke<RemuneracionMutationResponse>(
        "remuneracion:registrar",
        payload,
      );

      if (!response.ok) {
        setFieldErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      setResult(response.data);
      setMessage("Remuneracion registrada correctamente.");
      setForm((current) => ({ ...emptyForm, mes: current.mes, anio: current.anio }));
    } catch {
      setMessage("No fue posible comunicarse con el proceso principal.");
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
            Registrar remuneracion
          </h3>
          <p className="mt-2 text-sm text-[#61717f]">
            Menu Personal &gt; Remuneraciones &gt; Registrar.
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate("/app/personal/configuracion-previsional")}
        >
          Configuracion previsional
        </button>
      </div>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loading ? (
          <p className="font-semibold text-[#244d61]">Cargando datos...</p>
        ) : null}

        {!loading && loadError ? (
          <div className="grid gap-4" aria-live="assertive">
            <p className="text-sm font-semibold text-[#8f2727]">{loadError}</p>
            <button
              className="w-fit rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => void loadFormData()}
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
            <Field label="Trabajador" error={fieldErrors.trabajadorId}>
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
              <Field label="Mes" error={fieldErrors.mes}>
                <select
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  value={form.mes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      mes: event.target.value,
                    }))
                  }
                >
                  {MESES_LABEL.map((label, index) => (
                    <option key={label} value={index + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Anio" error={fieldErrors.anio}>
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  inputMode="numeric"
                  value={form.anio}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      anio: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Monto bruto" error={fieldErrors.montoBruto}>
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  inputMode="numeric"
                  placeholder="$"
                  value={form.montoBruto}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      montoBruto: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <Field label="Observacion (opcional)">
              <textarea
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                rows={2}
                value={form.observacion}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    observacion: event.target.value,
                  }))
                }
              />
            </Field>

            {preview ? (
              <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] px-4 py-3 text-sm text-[#24313d]">
                <p className="font-semibold">Vista previa del calculo</p>
                <ul className="mt-2 grid gap-1">
                  {preview.descuentos.map((descuento) => (
                    <li key={descuento.tipo}>
                      {PREVISIONAL_TIPO_LABELS[descuento.tipo]} (
                      {descuento.porcentaje}%): {formatCurrency(descuento.monto)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-semibold">
                  Liquido estimado: {formatCurrency(preview.montoLiquido)}
                </p>
                <p className="mt-1 text-xs text-[#61717f]">
                  El sistema revalida las tasas vigentes al guardar.
                </p>
              </div>
            ) : null}

            {message ? (
              <p
                className="rounded-md border border-[#d7dee6] bg-[#f8fafb] px-4 py-3 text-sm font-semibold text-[#24313d]"
                role="status"
              >
                {message}
              </p>
            ) : null}

            {result ? (
              <div className="rounded-md border border-[#bfe3cd] bg-[#f1faf4] px-4 py-3 text-sm text-[#1f5c3a]">
                <p className="font-semibold">Remuneracion guardada</p>
                <ul className="mt-2 grid gap-1">
                  {result.descuentos.map((descuento) => (
                    <li key={descuento.tipo}>
                      {PREVISIONAL_TIPO_LABELS[descuento.tipo]}:{" "}
                      {formatCurrency(descuento.monto)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-semibold">
                  Liquido: {formatCurrency(result.montoLiquido)}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                disabled={saving || workers.length === 0}
                type="submit"
              >
                {saving ? "Guardando..." : "Guardar remuneracion"}
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}
