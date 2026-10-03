import { useRef, useState, type FormEvent } from "react";
import { getChileDateKey } from "../../../shared/sales";
import {
  MONTHLY_SALES_EMPTY_MESSAGE, MONTHLY_SALES_REPORT_TYPE,
  formatMonthlySalesMoney, formatMonthlyVariation, monthlyPeriodLabel, paymentMethodLabels,
  type MonthlySalesPeriod, type MonthlySalesReport,
} from "../../../shared/monthly-sales";
import { GraficoVentasMensual } from "../components/GraficoVentasMensual";
import { AccionExportarFormato } from "../components/AccionExportarFormato";

export function ReporteMensualVentasView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const today = getChileDateKey();
  const [mes, setMes] = useState(Number(today.slice(5, 7)));
  const [anio, setAnio] = useState(Number(today.slice(0, 4)));
  const [report, setReport] = useState<MonthlySalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestVersion = useRef(0);
  const busy = loading || exporting;

  function changePeriod(period: MonthlySalesPeriod) {
    requestVersion.current += 1;
    setMes(period.mes);
    setAnio(period.anio);
    setReport(null);
    setError("");
    setNotice("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    setNotice("");
    setReport(null);
    try {
      const response = await window.appApi.invoke<MonthlySalesReport>("reporte:ventas-mensuales", { mes, anio });
      if (version !== requestVersion.current) return;
      if (response.ok) setReport(response.data);
      else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else if (response.error.message === MONTHLY_SALES_EMPTY_MESSAGE) setNotice(MONTHLY_SALES_EMPTY_MESSAGE);
      else setError(response.error.message);
    } catch {
      setError("No fue posible consultar las ventas mensuales. Intente nuevamente.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  return (
    <section className="space-y-6 px-8 py-8">
      <header><p className="text-sm text-[#61717f]">Reportes</p><h1 className="text-2xl font-semibold text-[#17202a]">Ventas mensuales</h1><p className="mt-2 text-sm text-[#61717f]">Consulta las ventas vigentes del mes y su comparación con el mes anterior.</p></header>
      <form onSubmit={generate} className="flex flex-wrap items-end gap-4 rounded-md border border-[#cbd5df] bg-white p-6">
        <label className="text-sm font-semibold">Mes
          <select className="mt-2 block rounded-md border border-[#9ba9b5] px-3 py-2" value={mes} disabled={busy} onChange={(event) => changePeriod({ mes: Number(event.target.value), anio })}>
            {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{new Intl.DateTimeFormat("es-CL", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 1)))}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Año
          <input className="mt-2 block w-28 rounded-md border border-[#9ba9b5] px-3 py-2" type="number" min="1900" max="9998" required value={Number.isNaN(anio) ? "" : anio} disabled={busy} onChange={(event) => changePeriod({ mes, anio: event.target.valueAsNumber })} />
        </label>
        <button className="rounded-md bg-[#1b4332] px-5 py-2 font-semibold text-white disabled:opacity-50" disabled={busy} type="submit">{loading ? "Generando…" : "Generar reporte"}</button>
      </form>
      {error ? <p role="alert" className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-[#b42318]">{error}</p> : null}
      {notice ? <p role="status" className="rounded-md border border-[#cbd5df] bg-white p-4">{notice}</p> : null}
      {report ? <article className="space-y-6 rounded-md border border-[#cbd5df] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold capitalize">{monthlyPeriodLabel(report.periodo)}</h2>
          {report.transacciones > 0 ? <AccionExportarFormato
            mode="report" request={{ tipo: MONTHLY_SALES_REPORT_TYPE, periodo: report.periodo }} disabled={loading}
            onBusyChange={setExporting} onForbidden={() => onNavigate("/app/inicio")}
          /> : null}
        </div>
        <MonthlySalesSummary report={report} />
        <GraficoVentasMensual dias={report.dias} />
        <MonthlySalesTables report={report} />
      </article> : null}
    </section>
  );
}

export function MonthlySalesSummary({ report }: { report: MonthlySalesReport }) {
  const items = [["Transacciones", report.transacciones], ["Total del mes", formatMonthlySalesMoney(report.montoTotal)], ["Monto mes anterior", formatMonthlySalesMoney(report.montoMesAnterior)], ["Variación frente al mes anterior", formatMonthlyVariation(report.variacionPorcentual)]];
  return <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map(([label, value]) => <div key={label} className="rounded-md bg-[#f6f7f9] p-4"><dt className="text-sm text-[#61717f]">{label}</dt><dd className="mt-2 text-xl font-semibold text-[#1b4332]">{value}</dd></div>)}</dl>;
}

export function MonthlySalesTables({ report }: { report: MonthlySalesReport }) {
  return <div className="grid gap-6 xl:grid-cols-2">
    <div><h3 className="mb-3 font-semibold">Desglose diario</h3><table className="w-full text-left text-sm"><thead className="bg-[#f6f7f9]"><tr><th className="p-3">Fecha</th><th>Transacciones</th><th>Monto CLP</th></tr></thead><tbody>{report.dias.map((day) => <tr className="border-b border-[#edf0f3]" key={day.fecha}><td className="p-3">{day.fecha.split("-").reverse().join("/")}</td><td>{day.transacciones}</td><td>{formatMonthlySalesMoney(day.monto)}</td></tr>)}</tbody></table></div>
    <div><h3 className="mb-3 font-semibold">Resumen por método de pago</h3><table className="w-full text-left text-sm"><thead className="bg-[#f6f7f9]"><tr><th className="p-3">Método</th><th>Transacciones</th><th>Monto CLP</th></tr></thead><tbody>{report.metodos.map((item) => <tr className="border-b border-[#edf0f3]" key={item.metodo}><td className="p-3">{paymentMethodLabels[item.metodo]}</td><td>{item.transacciones}</td><td>{formatMonthlySalesMoney(item.monto)}</td></tr>)}</tbody></table></div>
  </div>;
}
