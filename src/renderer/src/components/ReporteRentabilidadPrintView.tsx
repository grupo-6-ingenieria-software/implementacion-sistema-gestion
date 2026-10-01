import { formatChileanPeso } from "../../../shared/sales";
import { formatProfitability, profitabilityPeriodLabel, type CategoryProfitabilityReport } from "../../../shared/category-profitability";

export type ProfitabilityPrintInput = { report: CategoryProfitabilityReport; usuario: string; fecha: string };

export function ReporteRentabilidadPrintView({ report, usuario, fecha }: ProfitabilityPrintInput) {
  return <main>
    <h1>Minimarket y Panadería Huáscar</h1>
    <h2>Reporte de rentabilidad por categoría</h2>
    <p>Período: {profitabilityPeriodLabel(report.periodo)}</p>
    <p>Generado: {fecha} · Usuario: {usuario}</p>
    <table>
      <thead><tr><th>Categoría</th><th>Unidades vendidas</th><th>Costo total</th><th>Ingreso neto</th><th>Ganancia sobre costo (%)</th></tr></thead>
      <tbody>{report.categorias.map((row) => <tr key={row.categoriaId}>
        <td>{row.categoriaNombre}</td><td>{row.unidadesVendidas}</td>
        <td>{formatChileanPeso(row.costoTotal)}</td><td>{formatChileanPeso(row.ingresoNeto)}</td>
        <td>{formatProfitability(row.gananciaPorcentual)}</td>
      </tr>)}</tbody>
    </table>
  </main>;
}
