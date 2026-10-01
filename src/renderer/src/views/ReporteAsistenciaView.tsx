import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ATTENDANCE_REPORT_TYPE, attendanceFilterLabel, parseAttendanceReportRequest,
  type AttendanceReport, type AttendanceReportRequest,
} from "../../../shared/attendance-report";
import { monthlyPeriodLabel, REPORT_EXPORT_ERROR_MESSAGE, type ReportExportResult } from "../../../shared/monthly-sales";
import type { Role } from "../../../shared/navigation";
import { getChileDateKey } from "../../../shared/sales";
import { AttendanceReportTable } from "../components/AttendanceReportTable";

const inputClass = "mt-2 block rounded-md border border-[#9ba9b5] bg-white px-3 py-2 font-normal";
const buttonClass = "rounded-md border border-[#9ba9b5] px-4 py-2 font-semibold disabled:opacity-50";
const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("es-CL", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 15))));

export function ReporteAsistenciaView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const today = getChileDateKey();
  const [mes, setMes] = useState(Number(today.slice(5, 7)));
  const [anio, setAnio] = useState(today.slice(0, 4));
  const [rol, setRol] = useState<Role | "">("");
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestVersion = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => () => { requestVersion.current++; inFlight.current = false; }, []);

  function clearResult() {
    requestVersion.current++;
    inFlight.current = false;
    setLoading(false);
    setReport(null);
    setError("");
    setNotice("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    let request: AttendanceReportRequest;
    try { request = parseAttendanceReportRequest({ mes, anio: Number(anio), ...(rol ? { rol } : {}) }); }
    catch (error) { setError((error as Error).message); return; }
    const version = ++requestVersion.current;
    inFlight.current = true;
    setLoading(true);
    setReport(null);
    setError("");
    setNotice("");
    try {
      const response = await window.appApi.invoke<AttendanceReport>("reporte:asistencia", request);
      if (version !== requestVersion.current) return;
      if (response.ok) setReport(response.data);
      else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else setError(response.error.message);
    } catch {
      if (version === requestVersion.current) setError("No fue posible consultar el reporte de asistencia. Intente nuevamente.");
    } finally {
      if (version === requestVersion.current) { inFlight.current = false; setLoading(false); }
    }
  }

  async function exportReport(format: "pdf" | "xlsx") {
    if (!report?.filas.length || inFlight.current) return;
    const version = ++requestVersion.current;
    inFlight.current = true;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const response = await window.appApi.invoke<ReportExportResult>(`reporte:exportar-${format}`, {
        tipo: ATTENDANCE_REPORT_TYPE, periodo: report.periodo, ...(report.rol ? { rol: report.rol } : {}),
      });
      if (version !== requestVersion.current) return;
      if (response.ok) setNotice(response.data.estado === "saved" ? "Reporte guardado correctamente." : "Exportación cancelada.");
      else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else setError(response.error.message);
    } catch {
      if (version === requestVersion.current) setError(REPORT_EXPORT_ERROR_MESSAGE);
    } finally {
      if (version === requestVersion.current) { inFlight.current = false; setExporting(false); }
    }
  }

  return <section className="space-y-6 px-8 py-8">
    <header><p className="text-sm text-[#61717f]">Reportes</p>
      <h1 className="text-2xl font-semibold text-[#17202a]">Asistencia del personal</h1>
      <p className="mt-2 text-sm text-[#61717f]">Consulta la asistencia mensual del personal y sus ausencias.</p>
    </header>
    <form onSubmit={generate} noValidate className="flex flex-wrap items-end gap-4 rounded-md border border-[#cbd5df] bg-white p-6">
      <label className="text-sm font-semibold">Mes
        <select aria-label="Mes" className={inputClass} value={mes} disabled={exporting} onChange={(event) => { clearResult(); setMes(Number(event.target.value)); }}>
          {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Año
        <input aria-label="Año" className={`${inputClass} w-28`} type="number" min="1900" max="9998" step="1" value={anio}
          disabled={exporting} onChange={(event) => { clearResult(); setAnio(event.target.value); }} />
      </label>
      <label className="text-sm font-semibold">Rol
        <select aria-label="Rol" className={inputClass} value={rol} disabled={exporting} onChange={(event) => { clearResult(); setRol(event.target.value as Role | ""); }}>
          <option value="">Todos</option><option value="dueno">Dueño</option><option value="trabajador">Trabajador</option>
        </select>
      </label>
      <button className="rounded-md bg-[#1b4332] px-5 py-2 font-semibold text-white disabled:opacity-50"
        type="submit" disabled={loading || exporting}>{loading ? "Generando…" : "Generar reporte"}</button>
    </form>
    {error ? <p role="alert" className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-[#b42318]">{error}</p> : null}
    {notice ? <p role="status" className="rounded-md border border-[#cbd5df] bg-white p-4">{notice}</p> : null}
    {report ? <article aria-label="Reporte generado" className="space-y-4 rounded-md border border-[#cbd5df] bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-xl font-semibold capitalize">{monthlyPeriodLabel(report.periodo)}</h2>
          <p className="mt-1 text-sm text-[#61717f]">Rol: {attendanceFilterLabel(report.rol)}</p></div>
        <div className="flex gap-3">
          <button type="button" className={buttonClass} disabled={loading || exporting || !report.filas.length} onClick={() => exportReport("pdf")}>Exportar PDF</button>
          <button type="button" className={buttonClass} disabled={loading || exporting || !report.filas.length} onClick={() => exportReport("xlsx")}>Exportar Excel</button>
        </div>
      </div>
      <p className="text-sm text-[#61717f]">El promedio considera únicamente jornadas con salida. Las jornadas pendientes cuentan como días trabajados.</p>
      <AttendanceReportTable report={report} />
    </article> : null}
  </section>;
}
