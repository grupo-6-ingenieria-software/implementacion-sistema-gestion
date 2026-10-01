import { useRef, useState, type FormEvent } from "react";
import {
  formatProductsMostSoldDisplayDate,
  formatProductsMostSoldPercentage,
  parseProductsMostSoldDisplayDate,
  parseProductsMostSoldPeriod,
  PRODUCTS_MOST_SOLD_EMPTY_MESSAGE,
  PRODUCTS_MOST_SOLD_QUERY_ERROR_MESSAGE,
  PRODUCTS_MOST_SOLD_REPORT_TYPE,
  type ProductsMostSoldReport,
} from "../../../shared/products-most-sold";
import { REPORT_EXPORT_ERROR_MESSAGE, type ReportExportResult } from "../../../shared/monthly-sales";
import { formatChileanPeso, getChileDateKey } from "../../../shared/sales";

export function ReporteProductosVendidosView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const today = formatProductsMostSoldDisplayDate(getChileDateKey());
  const [inicio, setInicio] = useState(today);
  const [termino, setTermino] = useState(today);
  const [report, setReport] = useState<ProductsMostSoldReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestVersion = useRef(0);

  function changeDate(which: "inicio" | "termino", value: string) {
    requestVersion.current += 1;
    if (which === "inicio") setInicio(value);
    else setTermino(value);
    setReport(null);
    setLoading(false);
    setError("");
    setNotice("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const fechaInicio = parseProductsMostSoldDisplayDate(inicio);
    const fechaTermino = parseProductsMostSoldDisplayDate(termino);
    if (!fechaInicio || !fechaTermino) {
      setError("Ingrese fechas válidas en formato DD/MM/AAAA.");
      return;
    }
    let periodo;
    try {
      periodo = parseProductsMostSoldPeriod({ fechaInicio, fechaTermino });
    } catch (validationError) {
      setError((validationError as Error).message);
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    setNotice("");
    setReport(null);
    try {
      const response = await window.appApi.invoke<ProductsMostSoldReport>("reporte:productos-mas-vendidos", periodo);
      if (version !== requestVersion.current) return;
      if (response.ok) {
        setReport(response.data);
        if (response.data.status === "empty") setNotice(PRODUCTS_MOST_SOLD_EMPTY_MESSAGE);
      } else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else setError(response.error.message);
    } catch {
      if (version === requestVersion.current) setError(PRODUCTS_MOST_SOLD_QUERY_ERROR_MESSAGE);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  async function exportReport(format: "pdf" | "xlsx") {
    if (report?.status !== "ready" || loading || exporting) return;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const response = await window.appApi.invoke<ReportExportResult>(`reporte:exportar-${format}`, {
        tipo: PRODUCTS_MOST_SOLD_REPORT_TYPE,
        periodo: report.periodo,
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

  return <section className="space-y-6 px-8 py-8">
    <header>
      <p className="text-sm text-[#61717f]">Reportes</p>
      <h1 className="text-2xl font-semibold text-[#17202a]">Productos más vendidos</h1>
      <p className="mt-2 text-sm text-[#61717f]">Consulta los productos vendidos en el período y su ingreso neto.</p>
    </header>
    <form onSubmit={generate} className="flex flex-wrap items-end gap-4 rounded-md border border-[#cbd5df] bg-white p-6">
      <label htmlFor="mas-vendidos-inicio" className="text-sm font-semibold">Fecha de inicio
        <input id="mas-vendidos-inicio" type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/AAAA" value={inicio} disabled={exporting} onChange={(event) => changeDate("inicio", event.target.value)} className="mt-2 block w-40 rounded-md border border-[#9ba9b5] px-3 py-2" />
      </label>
      <label htmlFor="mas-vendidos-termino" className="text-sm font-semibold">Fecha de término
        <input id="mas-vendidos-termino" type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/AAAA" value={termino} disabled={exporting} onChange={(event) => changeDate("termino", event.target.value)} className="mt-2 block w-40 rounded-md border border-[#9ba9b5] px-3 py-2" />
      </label>
      <button type="submit" disabled={loading || exporting} className="rounded-md bg-[#1b4332] px-5 py-2 font-semibold text-white disabled:opacity-50">{loading ? "Generando…" : "Generar reporte"}</button>
    </form>
    {loading ? <p role="status" aria-live="polite" className="text-sm text-[#61717f]">Consultando ventas…</p> : null}
    {error ? <p role="alert" className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-[#b42318]">{error}</p> : null}
    {notice ? <p role="status" className="rounded-md border border-[#cbd5df] bg-white p-4">{notice}</p> : null}
    {report?.status === "ready" ? <article className="space-y-5 rounded-md border border-[#cbd5df] bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-xl font-semibold">Resultados del período</h2><p className="mt-1 text-sm text-[#61717f]">{formatProductsMostSoldDisplayDate(report.periodo.fechaInicio)} al {formatProductsMostSoldDisplayDate(report.periodo.fechaTermino)}</p></div>
        <div className="flex gap-3"><button type="button" disabled={exporting} onClick={() => exportReport("pdf")} className="rounded-md border border-[#9ba9b5] px-4 py-2 disabled:opacity-50">Exportar PDF</button><button type="button" disabled={exporting} onClick={() => exportReport("xlsx")} className="rounded-md border border-[#9ba9b5] px-4 py-2 disabled:opacity-50">Exportar Excel</button></div>
      </div>
      <p className="rounded-md bg-[#f6f7f9] p-4 text-sm">Total de unidades vendidas en el período: <strong className="text-lg text-[#1b4332]">{new Intl.NumberFormat("es-CL").format(report.totalUnidadesPeriodo)}</strong></p>
      <ProductsMostSoldTable report={report} />
    </article> : null}
  </section>;
}

export function ProductsMostSoldTable({ report }: { report: ProductsMostSoldReport }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm">
    <thead className="bg-[#f6f7f9]"><tr><th className="p-3">EAN</th><th className="p-3">Producto</th><th className="p-3">Categoría</th><th className="p-3 text-right">Unidades</th><th className="p-3 text-right">Ingreso neto</th><th className="p-3 text-right">% de unidades</th></tr></thead>
    <tbody>{report.filas.map((row) => <tr className="border-b border-[#edf0f3]" key={row.productoId}><td className="p-3 tabular-nums">{row.ean13}</td><td className="p-3">{row.nombre}</td><td className="p-3">{row.categoria}</td><td className="p-3 text-right tabular-nums">{new Intl.NumberFormat("es-CL").format(row.unidadesVendidas)}</td><td className="p-3 text-right tabular-nums">{formatChileanPeso(row.ingresoNeto)}</td><td className="p-3 text-right tabular-nums">{formatProductsMostSoldPercentage(row.porcentajeUnidades)}</td></tr>)}</tbody>
  </table></div>;
}
