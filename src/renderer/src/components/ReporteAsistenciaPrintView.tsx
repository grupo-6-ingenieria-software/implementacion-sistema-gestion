import { attendanceFilterLabel, type AttendanceReport } from "../../../shared/attendance-report";
import { monthlyPeriodLabel } from "../../../shared/monthly-sales";
import { AttendanceReportTable } from "./AttendanceReportTable";

export type AttendancePrintInput = { report: AttendanceReport; usuario: string; fecha: string };

export function ReporteAsistenciaPrintView({ report, usuario, fecha }: AttendancePrintInput) {
  return <main>
    <h1>Minimarket y Panadería Huáscar</h1>
    <h2>Reporte de asistencia del personal</h2>
    <p>Período: {monthlyPeriodLabel(report.periodo)}</p>
    <p>Rol: {attendanceFilterLabel(report.rol)}</p>
    <p>Generado: {fecha}</p><p>Usuario: {usuario}</p>
    <p>El promedio considera únicamente jornadas con salida. Las jornadas pendientes cuentan como días trabajados.</p>
    <AttendanceReportTable report={report} />
  </main>;
}
