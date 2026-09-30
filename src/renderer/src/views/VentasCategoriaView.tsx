import { useRef, useState, type FormEvent, type ReactElement, type Ref } from "react";
import {
  formatChileanPeso,
  getChileDateKey,
  type SaleCategoryResult,
} from "../../../shared/sales";

const integerFormat = new Intl.NumberFormat("es-CL");

export function VentasCategoriaView(): ReactElement {
  const today = getChileDateKey();
  const [fechaInicio, setFechaInicio] = useState(today);
  const [fechaTermino, setFechaTermino] = useState(today);
  const [result, setResult] = useState<SaleCategoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  function changeDate(
    setter: (value: string) => void,
    value: string,
  ): void {
    requestRef.current += 1;
    setter(value);
    setResult(null);
    setError(null);
    setValidationError(false);
    setLoading(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setValidationError(false);
    setResult(null);
    try {
      const response = await window.appApi.invoke<SaleCategoryResult>(
        "venta:por-categoria",
        { fechaInicio, fechaTermino },
      );
      if (requestId !== requestRef.current) return;
      if (!response.ok) {
        setError(response.error.message);
        setValidationError(response.error.code === "VALIDATION_ERROR");
        window.requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      setResult(response.data);
      window.requestAnimationFrame(() => resultRef.current?.focus());
    } catch {
      if (requestId !== requestRef.current) return;
      setError("No fue posible comunicarse con el proceso principal. Intente nuevamente.");
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <header>
        <h3 className="text-2xl font-semibold text-[#17202a]">
          Ventas por categoría
        </h3>
        <p className="mt-1 text-sm text-[#61717f]">
          Consulta unidades e ingreso neto de ventas vigentes del período.
        </p>
      </header>

      <form
        className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-[#24313d]" htmlFor="category-start-date">
              Fecha de inicio
            </label>
            <input
              id="category-start-date"
              className="rounded-md border border-[#9ba9b5] px-3 py-2"
              type="date"
              lang="es-CL"
              value={fechaInicio}
              aria-invalid={validationError}
              aria-describedby={error ? "category-date-help category-error" : "category-date-help"}
              onChange={(event) => changeDate(setFechaInicio, event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-[#24313d]" htmlFor="category-end-date">
              Fecha de término
            </label>
            <input
              id="category-end-date"
              className="rounded-md border border-[#9ba9b5] px-3 py-2"
              type="date"
              lang="es-CL"
              value={fechaTermino}
              aria-invalid={validationError}
              aria-describedby={error ? "category-date-help category-error" : "category-date-help"}
              onChange={(event) => changeDate(setFechaTermino, event.target.value)}
            />
          </div>
        </div>
        <p id="category-date-help" className="mt-3 text-sm text-[#61717f]">
          Selecciona fechas en formato DD/MM/AAAA. Se incluyen ambos días.
        </p>
        <div className="mt-5 flex justify-end border-t border-[#e3e8ee] pt-4">
          <button
            className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f4354] disabled:cursor-wait disabled:bg-[#9ba9b5]"
            disabled={loading}
            type="submit"
          >
            {loading ? "Consultando..." : "Consultar"}
          </button>
        </div>
      </form>

      {error ? (
        <p
          id="category-error"
          ref={errorRef}
          className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727] outline-none"
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="rounded-md border border-[#cbd5df] bg-white p-5 text-sm text-[#61717f]">
          Consultando ventas por categoría...
        </p>
      ) : null}
      {!loading && !error && !result ? (
        <p className="rounded-md border border-[#cbd5df] bg-white p-5 text-sm text-[#61717f]">
          Selecciona el período y presiona Consultar.
        </p>
      ) : null}
      {result ? <SaleCategoryBreakdown result={result} headingRef={resultRef} /> : null}
    </section>
  );
}

export function SaleCategoryBreakdown({
  result,
  headingRef,
}: {
  result: SaleCategoryResult;
  headingRef?: Ref<HTMLHeadingElement>;
}): ReactElement {
  return (
    <section className="overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
      <h4
        ref={headingRef}
        className="border-b border-[#e3e8ee] px-5 py-4 text-lg font-semibold text-[#17202a] outline-none"
        tabIndex={-1}
      >
        Desglose por categoría
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#f2f5f7] text-[#24313d]">
            <tr>
              <th className="px-5 py-3 font-semibold" scope="col">Categoría</th>
              <th className="px-5 py-3 text-right font-semibold" scope="col">Unidades vendidas</th>
              <th className="px-5 py-3 text-right font-semibold" scope="col">Ingreso neto</th>
            </tr>
          </thead>
          <tbody>
            {result.categorias.length === 0 ? (
              <tr>
                <td className="px-5 py-5 text-[#61717f]" colSpan={3}>
                  No hay ventas vigentes en el período seleccionado.
                </td>
              </tr>
            ) : result.categorias.map((category) => (
              <tr className="border-t border-[#e3e8ee]" key={category.categoriaId}>
                <th className="px-5 py-3 font-medium text-[#17202a]" scope="row">
                  {category.categoriaNombre}
                </th>
                <td className="px-5 py-3 text-right">{integerFormat.format(category.unidadesVendidas)}</td>
                <td className="px-5 py-3 text-right">{formatChileanPeso(category.montoNeto)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-[#cbd5df] bg-[#f8fafb] font-semibold text-[#17202a]">
            <tr>
              <th className="px-5 py-4" scope="row">Total</th>
              <td className="px-5 py-4 text-right">{integerFormat.format(result.totales.unidadesVendidas)}</td>
              <td className="px-5 py-4 text-right">{formatChileanPeso(result.totales.montoNeto)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
