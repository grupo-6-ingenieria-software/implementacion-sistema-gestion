import {
  formatMonthlySalesMoney, formatMonthlyVariation, monthlyPeriodLabel, monthlySalesChartImage, paymentMethodLabels,
  type MonthlySalesReport,
} from "../../../shared/monthly-sales";

export type MonthlySalesPrintInput = { report: MonthlySalesReport; usuario: string; fecha: string };

export function ReporteMensualVentasPrintView({ report, usuario, fecha }: MonthlySalesPrintInput) {
  return (
    <main>
      <h1>Minimarket y Panadería Huáscar</h1>
      <h2>Reporte mensual de ventas</h2>
      <p>Período: {monthlyPeriodLabel(report.periodo)} · Generado: {fecha} · Usuario: {usuario}</p>
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
    </main>
  );
}
