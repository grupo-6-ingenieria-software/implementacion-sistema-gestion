import { useState, type FormEvent } from "react";
import { formatChileanPeso, getChileDateKey } from "../../../shared/sales";
import {
  CATEGORY_PROFITABILITY_REPORT_TYPE, formatProfitability, profitabilityPeriodLabel,
  type CategoryProfitabilityReport,
} from "../../../shared/category-profitability";
import { REPORT_EXPORT_ERROR_MESSAGE, type ReportExportResult } from "../../../shared/monthly-sales";

export function ReporteRentabilidadView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [fechaInicio, setFechaInicio] = useState(getChileDateKey);
  const [fechaTermino, setFechaTermino] = useState(getChileDateKey);
  const [report, setReport] = useState<CategoryProfitabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState(false);
  const [notice, setNotice] = useState("");
  const busy = loading || exporting;

  function changeDate(setter: (value: string) => void, value: string) {
    setter(value);
    setReport(null);
    setError("");
    setValidationError(false);
    setNotice("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setLoading(true);
    setError("");
    setValidationError(false);
    setNotice("");
    setReport(null);
    try {
      const response = await window.appApi.invoke<CategoryProfitabilityReport>("reporte:rentabilidad-categoria", { fechaInicio, fechaTermino });
      if (response.ok) setReport(response.data);
      else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else {
        setError(response.error.message);
        setValidationError(response.error.code === "VALIDATION_ERROR");
      }
    } catch {
      setError("No fue posible consultar la rentabilidad por categoría. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  async function exportReport(format: "pdf" | "xlsx") {
    if (!report?.categorias.length || busy) return;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const response = await window.appApi.invoke<ReportExportResult>(`reporte:exportar-${format}`, {
        tipo: CATEGORY_PROFITABILITY_REPORT_TYPE, periodo: report.periodo,
      });
      if (response.ok) setNotice(response.data.estado === "saved" ? "Reporte guardado correctamente." : "Exportación cancelada.");
      else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else setError(response.error.message);
    } catch {
      setError(REPORT_EXPORT_ERROR_MESSAGE);
    } finally {
      setExporting(false);
    }
  }

  return <section className="space-y-6 px-8 py-8" aria-busy={busy}>
    <header>
      <p className="text-sm text-[#61717f]">Reportes</p>
      <h1 className="text-2xl font-semibold text-[#17202a]">Rentabilidad por categoría</h1>
      <p className="mt-2 text-sm text-[#61717f]">Consulta unidades vendidas, costos e ingresos netos del período.</p>
    </header>
    <form noValidate onSubmit={generate} className="rounded-md border border-[#cbd5df] bg-white p-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm font-semibold">Fecha de inicio
          <input className="mt-2 block rounded-md border border-[#9ba9b5] px-3 py-2" type="date" lang="es-CL" value={fechaInicio} disabled={busy} aria-invalid={validationError} aria-describedby={validationError ? "profitability-error" : undefined} onChange={(event) => changeDate(setFechaInicio, event.target.value)} />
        </label>
        <label className="text-sm font-semibold">Fecha de término
          <input className="mt-2 block rounded-md border border-[#9ba9b5] px-3 py-2" type="date" lang="es-CL" value={fechaTermino} disabled={busy} aria-invalid={validationError} aria-describedby={validationError ? "profitability-error" : undefined} onChange={(event) => changeDate(setFechaTermino, event.target.value)} />
        </label>
        <button className="rounded-md bg-[#1b4332] px-5 py-2 font-semibold text-white disabled:opacity-50" disabled={busy} type="submit">{loading ? "Generando…" : "Generar reporte"}</button>
      </div>
      <p className="mt-3 text-sm text-[#61717f]">Se incluyen ambos días del período seleccionado.</p>
    </form>
    {error ? <p id="profitability-error" role="alert" className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-[#b42318]">{error}</p> : null}
    {notice ? <p role="status" className="rounded-md border border-[#cbd5df] bg-white p-4">{notice}</p> : null}
    {report ? <article className="space-y-4 rounded-md border border-[#cbd5df] bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{profitabilityPeriodLabel(report.periodo)}</h2>
        {report.categorias.length > 0 ? <div className="flex gap-3">
          <button className="rounded-md border border-[#9ba9b5] px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => exportReport("pdf")}>Exportar PDF</button>
          <button className="rounded-md border border-[#9ba9b5] px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => exportReport("xlsx")}>Exportar Excel</button>
        </div> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Rentabilidad por categoría, ordenada por ganancia sobre costo de mayor a menor</caption>
          <thead className="bg-[#f6f7f9]"><tr>
            <th className="p-3" scope="col">Categoría</th><th className="p-3 text-right" scope="col">Unidades vendidas</th>
            <th className="p-3 text-right" scope="col">Costo total</th><th className="p-3 text-right" scope="col">Ingreso neto</th>
            <th className="p-3 text-right" scope="col">Ganancia sobre costo (%)</th>
          </tr></thead>
          <tbody>{report.categorias.map((row) => <tr className="border-b border-[#edf0f3]" key={row.categoriaId}>
            <th className="p-3 font-medium" scope="row">{row.categoriaNombre}</th>
            <td className="p-3 text-right">{row.unidadesVendidas.toLocaleString("es-CL")}</td>
            <td className="p-3 text-right">{formatChileanPeso(row.costoTotal)}</td>
            <td className="p-3 text-right">{formatChileanPeso(row.ingresoNeto)}</td>
            <td className="p-3 text-right">{formatProfitability(row.gananciaPorcentual)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </article> : null}
  </section>;
}
