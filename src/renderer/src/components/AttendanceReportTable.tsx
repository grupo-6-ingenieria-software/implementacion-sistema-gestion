import { attendanceReportColumns, attendanceReportValues, type AttendanceReport } from "../../../shared/attendance-report";

export function AttendanceReportTable({ report }: { report: AttendanceReport }) {
  return <div className="overflow-x-auto">
    <table aria-label="Reporte de asistencia" className="w-full text-left text-sm">
      <thead className="bg-[#f6f7f9]"><tr>{attendanceReportColumns.map((column) =>
        <th key={column} scope="col" className="px-4 py-3">{column}</th>)}</tr></thead>
      <tbody>{report.filas.map((row) => <tr key={row.trabajadorId} className="border-b border-[#edf0f3]">
        {attendanceReportValues(row).map((value, index) => <td key={index} className="px-4 py-3">{value}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}
