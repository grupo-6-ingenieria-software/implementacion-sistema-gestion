import { useEffect, useState, type ReactElement } from "react";
import {
  DEFAULT_PREVISIONAL_RATES,
  PREVISIONAL_TIPOS,
  PREVISIONAL_TIPO_LABELS,
  type PrevisionalFieldErrors,
  type PrevisionalRates,
  type TasaLegalTipo,
} from "../../../shared/previsional";

type ConfigurarPorcentajesPrevisionalesViewProps = {
  usuarioId: string;
};

export function ConfigurarPorcentajesPrevisionalesView({
  usuarioId,
}: ConfigurarPorcentajesPrevisionalesViewProps): ReactElement {
  const [rates, setRates] = useState<Record<TasaLegalTipo, string>>(() =>
    toTextRates(DEFAULT_PREVISIONAL_RATES),
  );
  const [fieldErrors, setFieldErrors] = useState<PrevisionalFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadRates(): Promise<void> {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await window.appApi.invoke<PrevisionalRates>(
        "configuracion:previsional-obtener",
        { usuarioId },
      );

      if (!response.ok) {
        setLoadError(response.error.message);
        return;
      }

      setRates(toTextRates(response.data));
    } catch {
      setLoadError("No fue posible comunicarse con el proceso principal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRates();
  }, [usuarioId]);

  async function submit(): Promise<void> {
    setFieldErrors({});
    setMessage(null);
    setSaving(true);

    try {
      const response = await window.appApi.invoke<PrevisionalRates>(
        "configuracion:previsional-actualizar",
        {
          usuarioId,
          afp: parseRate(rates.afp),
          salud: parseRate(rates.salud),
          cesantia: parseRate(rates.cesantia),
        },
      );

      if (!response.ok) {
        setFieldErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      setRates(toTextRates(response.data));
      setMessage(
        "Porcentajes actualizados. Solo aplican a remuneraciones registradas despues de esta modificacion.",
      );
    } catch {
      setMessage("No fue posible comunicarse con el proceso principal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <div>
        <p className="text-sm font-semibold text-[#2d6a4f]">Personal</p>
        <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
          Configuracion previsional
        </h3>
        <p className="mt-2 text-sm text-[#61717f]">
          Menu Personal &gt; Configuracion previsional.
        </p>
      </div>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loading ? (
          <p className="font-semibold text-[#244d61]">
            Cargando porcentajes vigentes...
          </p>
        ) : null}

        {!loading && loadError ? (
          <div className="grid gap-4" aria-live="assertive">
            <p className="text-sm font-semibold text-[#8f2727]">{loadError}</p>
            <button
              className="w-fit rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => void loadRates()}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <form
            className="grid max-w-xl gap-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {PREVISIONAL_TIPOS.map((tipo) => (
              <Field
                key={tipo}
                label={`${PREVISIONAL_TIPO_LABELS[tipo]} (%)`}
                error={fieldErrors[tipo]}
              >
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  inputMode="decimal"
                  value={rates[tipo]}
                  onChange={(event) =>
                    setRates((current) => ({
                      ...current,
                      [tipo]: event.target.value,
                    }))
                  }
                />
              </Field>
            ))}

            <p className="rounded-md bg-[#f6f7f9] px-4 py-3 text-sm text-[#61717f]">
              Los cambios rigen para remuneraciones registradas despues de la
              confirmacion. Las remuneraciones ya registradas conservan las
              tasas con las que se calcularon.
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
                disabled={saving}
                type="submit"
              >
                {saving ? "Guardando..." : "Guardar"}
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

function toTextRates(
  rates: PrevisionalRates,
): Record<TasaLegalTipo, string> {
  return {
    afp: String(rates.afp),
    salud: String(rates.salud),
    cesantia: String(rates.cesantia),
  };
}

function parseRate(value: string): number {
  return Number(value.trim().replace(",", "."));
}
