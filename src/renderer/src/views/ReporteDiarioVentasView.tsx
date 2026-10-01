import { useRef, useState, type ReactElement } from "react";
import { DAILY_SALES_EMPTY_MESSAGE, REPORT_EXPORT_ERROR_MESSAGE, type DailySalesExportResult, type DailySalesReport } from "../../../shared/reports";
import { getChileDateKey, isValidSaleHistoryDate } from "../../../shared/sales";
import { AccionExportarFormato } from "../components/AccionExportarFormato";

const money = (value: number): string => `$${value.toLocaleString("es-CL")}`;
const dateLabel = (date: string): string => date.split("-").reverse().join("/");
const hourLabel = (value: string): string => {
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }).format(date);
};

export function ReporteDiarioVentasView(): ReactElement {
  const [fecha, setFecha] = useState(() => getChileDateKey());
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf");
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const sequence = useRef(0);

  const generate = async (): Promise<void> => {
    setError(null); setExportNotice(null); setReport(null);
    if (!isValidSaleHistoryDate(fecha)) { setError("Ingrese una fecha válida."); return; }
    const request = ++sequence.current;
    setLoading(true);
    try {
      const response = await window.appApi.invoke<DailySalesReport>("reporte:ventas-diarias", { fecha });
      if (request !== sequence.current) return;
      if (!response.ok) { setError(response.error.message); return; }
      setReport(response.data);
    } catch {
      if (request === sequence.current) setError("No fue posible consultar el reporte.");
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  };

  const exportReport = async (): Promise<void> => {
    if (!report?.tieneVentas || exporting) return;
    setExporting(true); setExportNotice(null);
    try {
      const response = await window.appApi.invoke<DailySalesExportResult>(`reporte:exportar-${format}`, { tipo: "ventas-diarias", fecha: report.fecha });
      if (!response.ok) { setExportNotice(response.error.message === DAILY_SALES_EMPTY_MESSAGE ? DAILY_SALES_EMPTY_MESSAGE : REPORT_EXPORT_ERROR_MESSAGE); return; }
      setExportNotice(response.data.estado === "cancelled" ? "Exportación cancelada." : `Archivo guardado en ${response.data.ruta ?? "la ubicación seleccionada"}`);
    } catch { setExportNotice(REPORT_EXPORT_ERROR_MESSAGE); }
    finally { setExporting(false); }
  };

  const onDateChange = (next: string): void => { sequence.current += 1; setFecha(next); setReport(null); setError(null); setExportNotice(null); setLoading(false); };
  const methods = ["efectivo", "debito", "credito", "transferencia"] as const;
  return <section className="px-8 py-8">
    <article className="rounded-md border border-[#cbd5df] bg-white shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#cbd5df] px-6 py-5">
        <div><h2 className="text-xl font-semibold text-[#17202a]">Reporte diario de ventas</h2><p className="mt-1 text-sm text-[#61717f]">Seleccione un día para revisar ventas, productos y caja.</p></div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-semibold text-[#24313d]">Fecha (DD/MM/AAAA)<input aria-label="Fecha del reporte" className="rounded-md border border-[#9ba9b5] bg-white px-3 py-2 text-sm font-normal" type="date" value={fecha} onChange={(event) => onDateChange(event.target.value)} /></label>
          <button className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={loading || exporting} onClick={() => void generate()} type="button">{loading ? "Generando..." : "Generar reporte"}</button>
          <AccionExportarFormato format={format} disabled={!report?.tieneVentas} exporting={exporting} onFormatChange={setFormat} onExport={() => void exportReport()} />
        </div>
      </header>
      {error && <p className="m-6 rounded-md border border-[#fecdca] bg-[#fff3f1] px-4 py-3 text-sm text-[#b42318]" role="alert">{error}</p>}
      {exportNotice && <p className="m-6 rounded-md border border-[#cbd5df] bg-[#f6f7f9] px-4 py-3 text-sm" role="status">{exportNotice}</p>}
      {report && !report.tieneVentas && <div className="space-y-5 px-6 py-8">
        <p className="text-center text-sm text-[#61717f]" role="status">{DAILY_SALES_EMPTY_MESSAGE}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Ventas vigentes" count={0} amount={0} />
          <SummaryCard label="Ventas anuladas" count={0} amount={0} />
        </div>
        <ReportTable title="Por método de pago" headers={["Método", "Cantidad", "Monto"]} rows={methods.map((method) => [method, 0, money(0)])} />
      </div>}
      {report?.tieneVentas && <div className="space-y-8 px-6 py-6">
        <p className="text-sm text-[#61717f]">Período: <strong className="text-[#17202a]">{dateLabel(report.fecha)}</strong></p>
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Ventas vigentes" count={report.resumen.ventasVigentes} amount={report.resumen.montoVigente} />
          <SummaryCard label="Ventas anuladas" count={report.resumen.ventasAnuladas} amount={report.resumen.montoAnulado} />
          <div className="rounded-md border border-[#cbd5df] bg-[#f6f7f9] p-4"><h3 className="font-semibold">Caja</h3><p className="mt-2 capitalize">{report.caja.estado}</p>{report.caja.fechaHoraCierre && <p className="text-sm">Cierre: {hourLabel(report.caja.fechaHoraCierre)}</p>}</div>
        </div>
        <ReportTable title="Por método de pago" headers={["Método", "Cantidad", "Monto"]} rows={methods.map((method) => [method, report.resumen.porMetodoPago[method].cantidad, money(report.resumen.porMetodoPago[method].monto)])} />
        <ReportTable title="Top 5 productos por unidades" headers={["Producto", "EAN-13", "Unidades", "Ingreso neto"]} rows={report.topProductos.map((item) => [item.nombre, item.ean13, item.unidades, money(item.montoNeto)])} />
        <ReportTable title="Listado de ventas" headers={["Número", "Hora", "Responsable", "Estado", "Método", "Total"]} rows={report.ventas.map((sale) => [sale.ventaId, hourLabel(sale.fechaHora), sale.responsable.nombre, sale.estado, sale.metodoPago, money(sale.total)])} />
      </div>}
    </article>
  </section>;
}

function SummaryCard({ label, count, amount }: { label: string; count: number; amount: number }): ReactElement {
  return <div className="rounded-md border border-[#cbd5df] bg-[#f6f7f9] p-4"><h3 className="font-semibold">{label}</h3><p className="mt-2 text-2xl font-semibold text-[#1b4332]">{money(amount)}</p><p className="text-sm text-[#61717f]">{count} ventas</p></div>;
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }): ReactElement {
  return <div><h3 className="mb-3 text-lg font-semibold text-[#17202a]">{title}</h3><div className="overflow-x-auto rounded-md border border-[#cbd5df]"><table className="w-full text-left text-sm"><thead className="bg-[#f6f7f9]"><tr>{headers.map((header) => <th className="px-3 py-2 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-[#edf0f3]" key={index}>{row.map((cell, cellIndex) => <td className="px-3 py-2" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{rows.length === 0 && <p className="mt-2 text-sm text-[#61717f]">Sin datos en esta sección.</p>}</div>;
}
