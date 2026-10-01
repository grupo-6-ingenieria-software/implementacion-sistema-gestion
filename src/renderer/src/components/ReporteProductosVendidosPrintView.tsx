import {
  formatProductsMostSoldDisplayDate,
  formatProductsMostSoldPercentage,
  type ProductsMostSoldReport,
} from "../../../shared/products-most-sold";
import { formatChileanPeso } from "../../../shared/sales";

export type ProductsMostSoldPrintInput = { report: ProductsMostSoldReport; usuario: string; fecha: string };

export function ReporteProductosVendidosPrintView({ report, usuario, fecha }: ProductsMostSoldPrintInput) {
  return <main>
    <h1>Minimarket y Panadería Huáscar</h1>
    <h2>Reporte de productos más vendidos</h2>
    <p>Período: {formatProductsMostSoldDisplayDate(report.periodo.fechaInicio)} al {formatProductsMostSoldDisplayDate(report.periodo.fechaTermino)}</p>
    <p>Generado: {fecha} · Usuario: {usuario}</p>
    <p>Total de unidades vendidas en el período: {new Intl.NumberFormat("es-CL").format(report.totalUnidadesPeriodo)}</p>
    <table><thead><tr><th>EAN</th><th>Producto</th><th>Categoría</th><th>Unidades</th><th>Ingreso neto</th><th>% de unidades</th></tr></thead>
      <tbody>{report.filas.map((row) => <tr key={row.productoId}><td>{row.ean13}</td><td>{row.nombre}</td><td>{row.categoria}</td><td>{row.unidadesVendidas}</td><td>{formatChileanPeso(row.ingresoNeto)}</td><td>{formatProductsMostSoldPercentage(row.porcentajeUnidades)}</td></tr>)}</tbody>
    </table>
  </main>;
}
