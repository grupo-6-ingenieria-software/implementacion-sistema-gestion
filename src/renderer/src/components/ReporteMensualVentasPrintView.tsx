import {
  formatMonthlySalesMoney, formatMonthlyVariation, monthlyPeriodLabel, paymentMethodLabels,
  type MonthlySalesReport,
} from "../../../shared/monthly-sales";
import { monthlySalesChartImage } from "./GraficoVentasMensual";
import { REPORT_BUSINESS_NAME, type ReportHeader } from "../../../shared/reports";
import { ReportPrintLayout } from "./ReportePrintView";

export type MonthlySalesPrintInput = { report: MonthlySalesReport; usuario: string; fecha: string; header?: ReportHeader };

export function monthlySalesPrintHeader(input: MonthlySalesPrintInput): ReportHeader {
  return input.header ?? { negocio: REPORT_BUSINESS_NAME, tipo: "Reporte mensual de ventas", periodo: monthlyPeriodLabel(input.report.periodo), fecha: input.fecha, usuario: input.usuario };
}

export function ReporteMensualVentasPrintView(input: MonthlySalesPrintInput) {
  const { report } = input;
  return (
    <ReportPrintLayout header={monthlySalesPrintHeader(input)}>
      <p>Transacciones: {report.transacciones} · Total: {formatMonthlySalesMoney(report.montoTotal)}</p>
      <p>Mes anterior: {formatMonthlySalesMoney(report.montoMesAnterior)} · Variación: {formatMonthlyVariation(report.variacionPorcentual)}</p>
      <img alt="Evolución diaria del monto vendido" src={monthlySalesChartImage(report.dias)} width="1000" height="300" style={{ width: "100%", height: "auto" }} />
      <table><thead><tr><th>Fecha</th><th>Transacciones</th><th>Monto CLP</th></tr></thead>
        <tbody>{report.dias.map((day) => <tr key={day.fecha}><td>{day.fecha.split("-").reverse().join("/")}</td><td>{day.transacciones}</td><td>{formatMonthlySalesMoney(day.monto)}</td></tr>)}</tbody>
      </table>
      <h2>Resumen por método de pago</h2>
      <table><thead><tr><th>Método</th><th>Transacciones</th><th>Monto CLP</th></tr></thead>
        <tbody>{report.metodos.map((item) => <tr key={item.metodo}><td>{paymentMethodLabels[item.metodo]}</td><td>{item.transacciones}</td><td>{formatMonthlySalesMoney(item.monto)}</td></tr>)}</tbody>
      </table>
    </ReportPrintLayout>
  );
}
