import type { ReactElement } from "react";
import type {
  ExpiringLotItem,
  ExpiringLotsReportSummary,
} from "../../../shared/report-expiring-lots";

export type ReporteLotesVencerPrintViewProps = {
  horizonte: number;
  categoriaNombre?: string;
  fechaGeneracion: string;
  items: readonly ExpiringLotItem[];
  resumen: ExpiringLotsReportSummary;
  usuario: string;
};

export function ReporteLotesVencerPrintView({
  horizonte,
  categoriaNombre,
  fechaGeneracion,
  items,
  resumen,
  usuario,
}: ReporteLotesVencerPrintViewProps): ReactElement {
  return (
    <main className="expiring-lots-report-print-view">
      <header>
        <h1>Minimarket y Panadería Huáscar</h1>
        <h2>Reporte de lotes próximos a vencer</h2>
        <dl className="report-metadata">
          <div>
            <dt>Horizonte</dt>
            <dd>{horizonte} días</dd>
          </div>
          <div>
            <dt>Categoría</dt>
            <dd>{categoriaNombre ?? "Todas"}</dd>
          </div>
          <div>
            <dt>Fecha de generación</dt>
            <dd>{fechaGeneracion}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{usuario}</dd>
          </div>
        </dl>
      </header>

      <section className="report-summary" style={{ marginBottom: "16px" }}>
        <table style={{ width: "100%", marginBottom: "16px" }}>
          <thead>
            <tr>
              <th>Total lotes por vencer</th>
              <th>Total unidades</th>
              <th>Costo total en riesgo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                {resumen.totalLotes}
              </td>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                {resumen.totalUnidades}
              </td>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                ${resumen.costoTotalEnRiesgo.toLocaleString("es-CL")}
              </td>
            </tr>
          </tbody>
        </table>

        {resumen.porCategoria.length > 0 && (
          <table style={{ width: "100%", marginBottom: "16px" }}>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Lotes</th>
                <th>Unidades</th>
                <th>Costo en riesgo</th>
              </tr>
            </thead>
            <tbody>
              {resumen.porCategoria.map((cat) => (
                <tr key={cat.categoriaId}>
                  <td>{cat.categoriaNombre}</td>
                  <td className="numeric">{cat.totalLotes}</td>
                  <td className="numeric">{cat.totalUnidades}</td>
                  <td className="numeric">
                    ${cat.costoEnRiesgo.toLocaleString("es-CL")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>EAN-13</th>
            <th>Categoría</th>
            <th>Proveedor</th>
            <th>Lote</th>
            <th>Unidades</th>
            <th>Vencimiento</th>
            <th>Días rest.</th>
            <th>Costo unitario</th>
            <th>Costo en riesgo</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.loteId}>
              <td>{item.productoNombre}</td>
              <td>{item.productoEan13}</td>
              <td>{item.categoriaNombre}</td>
              <td>{item.proveedorNombre ?? "Sin proveedor"}</td>
              <td style={{ fontFamily: "monospace", fontSize: "8pt" }}>
                {item.loteId.slice(0, 8)}
              </td>
              <td className="numeric">{item.cantidad}</td>
              <td>{item.fechaVencimiento}</td>
              <td className="numeric">{item.diasRestantes}</td>
              <td className="numeric">
                ${item.precioCosto.toLocaleString("es-CL")}
              </td>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                ${item.costoEnRiesgo.toLocaleString("es-CL")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
