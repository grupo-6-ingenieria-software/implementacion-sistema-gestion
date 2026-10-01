import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatWorkedMinutes, normalizeRut } from "../../../shared/attendance";
import {
  MONTHLY_ATTENDANCE_EMPTY_MESSAGE, monthlyAttendanceStatusLabels, parseMonthlyAttendanceRequest,
  type MonthlyAttendanceSummary, type MonthlyAttendanceWorker,
} from "../../../shared/monthly-attendance";
import { getChileDateKey } from "../../../shared/sales";
import { formatShiftTimestamp, isoDateToDisplay } from "../../../shared/shifts";

const inputClass = "mt-2 block w-full rounded-md border border-[#9ba9b5] bg-white px-3 py-2 font-normal text-[#24313d]";
const buttonClass = "rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] disabled:opacity-50";
const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("es-CL", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 15))));

export function ResumenMensualAsistenciaView({ initialRut, onNavigate }: {
  initialRut?: string;
  onNavigate: (path: string) => void;
}) {
  const today = getChileDateKey();
  const [workers, setWorkers] = useState<MonthlyAttendanceWorker[]>([]);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [workersError, setWorkersError] = useState("");
  const [workerNotice, setWorkerNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [trabajadorId, setTrabajadorId] = useState(0);
  const [mes, setMes] = useState(Number(today.slice(5, 7)));
  const [anio, setAnio] = useState(today.slice(0, 4));
  const [report, setReport] = useState<MonthlyAttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const inFlight = useRef(false);
  const navigateRef = useRef(onNavigate);

  useEffect(() => { navigateRef.current = onNavigate; }, [onNavigate]);

  useEffect(() => {
    let active = true;
    requestVersion.current++;
    inFlight.current = false;
    setLoading(false);
    setReport(null);
    setWorkersLoading(true);
    setWorkersError("");
    setWorkerNotice("");
    void (async () => {
      try {
        const response = await window.appApi.invoke<MonthlyAttendanceWorker[]>("trabajador:listar-para-resumen", {});
        if (!active) return;
        if (!response.ok) {
          if (response.error.code === "FORBIDDEN") navigateRef.current("/app/inicio");
          else setWorkersError(response.error.message);
          return;
        }
        setWorkers(response.data);
        const selected = initialRut ? response.data.find((worker) => normalizeRut(worker.rut) === normalizeRut(initialRut)) : undefined;
        setTrabajadorId(selected?.trabajadorId ?? 0);
        if (initialRut && !selected) setWorkerNotice("El trabajador seleccionado ya no existe. Seleccione otro trabajador.");
      } catch {
        if (active) setWorkersError("No fue posible cargar los trabajadores. Intente nuevamente.");
      } finally {
        if (active) setWorkersLoading(false);
      }
    })();
    return () => { active = false; requestVersion.current++; inFlight.current = false; };
  }, [initialRut, reloadKey]);

  const visibleWorkers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-CL");
    const rutTerm = term.replace(/[.\s-]/g, "");
    return workers.filter((worker) => worker.trabajadorId === trabajadorId ||
      worker.nombreCompleto.toLocaleLowerCase("es-CL").includes(term) ||
      worker.rut.replace(/[.\s-]/g, "").toLowerCase().includes(rutTerm));
  }, [workers, search, trabajadorId]);

  function clearResult() {
    requestVersion.current++;
    inFlight.current = false;
    setLoading(false);
    setReport(null);
    setError("");
  }

  async function consult(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || workersLoading || workersError) return;
    let request;
    try { request = parseMonthlyAttendanceRequest({ trabajadorId, mes, anio: Number(anio) }); }
    catch (error) { setError((error as Error).message); return; }
    const version = ++requestVersion.current;
    inFlight.current = true;
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const response = await window.appApi.invoke<MonthlyAttendanceSummary>("asistencia:resumen-mensual", request);
      if (version !== requestVersion.current) return;
      if (response.ok) setReport(response.data);
      else if (response.error.code === "FORBIDDEN") onNavigate("/app/inicio");
      else setError(response.error.message);
    } catch {
      if (version === requestVersion.current) setError("No fue posible consultar el resumen de asistencia. Intente nuevamente.");
    } finally {
      if (version === requestVersion.current) { inFlight.current = false; setLoading(false); }
    }
  }

  return <section className="space-y-6 px-8 py-8">
    <header>
      <p className="text-sm text-[#61717f]">Personal</p>
      <h1 className="text-2xl font-semibold text-[#17202a]">Resumen mensual de asistencia</h1>
      <p className="mt-2 text-sm text-[#61717f]">Consulta la asistencia y las ausencias de un trabajador, con sus totales mensuales y semanales.</p>
    </header>
    {workersLoading ? <p role="status">Cargando trabajadores...</p> : null}
    {workersError ? <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <p role="alert">{workersError}</p>
      <button type="button" className={`${buttonClass} mt-3`} onClick={() => setReloadKey((key) => key + 1)}>Reintentar carga</button>
    </div> : null}
    {workerNotice ? <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-4">{workerNotice}</p> : null}
    {!workersLoading && !workersError && workers.length === 0 ? <p role="status">No hay trabajadores registrados.</p> : null}
    <form onSubmit={consult} noValidate className="rounded-md border border-[#cbd5df] bg-white p-6">
      <div className="grid gap-4 md:grid-cols-[minmax(220px,2fr)_minmax(160px,1fr)_120px]">
        <div className="space-y-3">
          <label className="block text-sm font-semibold">Buscar trabajador por nombre o RUT
            <input aria-label="Buscar trabajador por nombre o RUT" className={inputClass} value={search} disabled={workersLoading || !!workersError}
              onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Nombre o RUT" />
          </label>
          <label className="block text-sm font-semibold">Trabajador
            <select aria-label="Trabajador" className={inputClass} value={trabajadorId || ""} disabled={workersLoading || !!workersError}
              onChange={(event) => { clearResult(); setTrabajadorId(Number(event.target.value)); setWorkerNotice(""); }}>
              <option value="">Seleccione un trabajador</option>
              {visibleWorkers.map((worker) => <option key={worker.trabajadorId} value={worker.trabajadorId}>
                {worker.nombreCompleto} · {worker.rut}{worker.estado === "inactivo" ? " · Inactivo" : ""}
              </option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">Mes
          <select aria-label="Mes" className={inputClass} value={mes} onChange={(event) => { clearResult(); setMes(Number(event.target.value)); }}>
            {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Año
          <input aria-label="Año" className={inputClass} type="number" min="1900" max="9998" step="1" value={anio}
            onChange={(event) => { clearResult(); setAnio(event.target.value); }} />
        </label>
      </div>
      <button className="mt-5 rounded-md bg-[#1b4332] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        disabled={loading || workersLoading || !!workersError || workers.length === 0} type="submit">
        {loading ? "Consultando..." : "Consultar resumen"}
      </button>
    </form>
    {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4">{error}</p> : null}
    {loading ? <p role="status">Consultando resumen de asistencia...</p> : null}
    {report ? <MonthlyAttendanceResult report={report} /> : null}
  </section>;
}

function MonthlyAttendanceResult({ report }: { report: MonthlyAttendanceSummary }) {
  const totals = [
    ["Días trabajados", report.totales.diasTrabajados],
    ["Horas trabajadas del mes", formatWorkedMinutes(report.totales.minutosTrabajados)],
    ["Ausencias justificadas", report.totales.ausenciasJustificadas],
    ["Ausencias injustificadas", report.totales.ausenciasInjustificadas],
  ] as const;
  return <article className="space-y-6 rounded-md border border-[#cbd5df] bg-white p-6" aria-label="Resumen consultado">
    <header>
      <h2 className="text-xl font-semibold text-[#17202a]">{report.trabajador.nombreCompleto}</h2>
      <p className="mt-1 text-sm text-[#61717f]">{report.trabajador.rut} · {months[report.periodo.mes - 1]} de {report.periodo.anio}
        {report.trabajador.estado === "inactivo" ? " · Trabajador inactivo" : ""}</p>
    </header>
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {totals.map(([label, value]) => <div className="rounded-md bg-[#f6f7f9] p-4" key={label}>
        <dt className="text-sm text-[#61717f]">{label}</dt><dd className="mt-2 text-2xl font-semibold text-[#1b4332]">{value}</dd>
      </div>)}
    </dl>
    <p className="text-sm text-[#61717f]">Las jornadas pendientes cuentan como días trabajados y no suman horas.</p>
    <div>
      <h3 className="mb-3 text-lg font-semibold">Detalle diario</h3>
      {report.dias.length === 0 ? <p role="status" className="mb-3 text-sm text-[#61717f]">{MONTHLY_ATTENDANCE_EMPTY_MESSAGE}</p> : null}
      <div className="overflow-x-auto">
        <table aria-label="Detalle diario" className="w-full text-left text-sm">
          <thead className="bg-[#f6f7f9]"><tr>{["Fecha", "Entrada", "Salida", "Horas trabajadas", "Estado"].map((label) => <th className="px-4 py-3" scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{report.dias.map((day) => <tr key={day.fecha} className="border-b border-[#edf0f3]">
            <td className="px-4 py-3 whitespace-nowrap">{isoDateToDisplay(day.fecha)}</td>
            <td className="px-4 py-3">{day.entradaAt ? formatShiftTimestamp(day.entradaAt).hora : "—"}</td>
            <td className="px-4 py-3">{day.salidaAt ? <>
              {formatShiftTimestamp(day.salidaAt).hora}
              {getChileDateKey(new Date(day.salidaAt)) !== day.fecha ? <span className="block text-xs text-[#61717f]">{formatShiftTimestamp(day.salidaAt).fecha}</span> : null}
            </> : "—"}</td>
            <td className="px-4 py-3 font-mono">{day.estado === "pendiente" ? "Pendiente" : day.minutosTrabajados === null ? "—" : formatWorkedMinutes(day.minutosTrabajados)}</td>
            <td className="px-4 py-3">{monthlyAttendanceStatusLabels[day.estado]}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <div>
      <h3 className="mb-3 text-lg font-semibold">Desglose semanal</h3>
      <p className="mb-3 text-sm text-[#61717f]">Semanas de lunes a domingo. Cada rango incluye únicamente las fechas del mes consultado.</p>
      <table aria-label="Desglose semanal" className="w-full text-left text-sm">
        <thead className="bg-[#f6f7f9]"><tr><th scope="col" className="px-4 py-3">Período</th><th scope="col" className="px-4 py-3">Horas trabajadas</th></tr></thead>
        <tbody>{report.semanas.map((week) => <tr key={week.desde} className="border-b border-[#edf0f3]">
          <td className="px-4 py-3">{isoDateToDisplay(week.desde)} – {isoDateToDisplay(week.hasta)}</td>
          <td className="px-4 py-3 font-mono">{formatWorkedMinutes(week.minutosTrabajados)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </article>;
}
