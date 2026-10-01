import type { ReactElement } from "react";
import type { WasteReportItem, WasteReportSummary } from "../../../shared/report-waste";

export type ReporteMermasPrintViewProps = {
  fechaInicio: string;
  fechaTermino: string;
  fechaGeneracion: string;
  items: readonly WasteReportItem[];
  resumen: WasteReportSummary;
  usuario: string;
};

const MOTIVO_LABELS: Record<string, string> = {
  vencimiento: "Vencimiento",
  dano: "Daño",
  robo: "Robo",
  error_registro: "Error de registro",
};

export function ReporteMermasPrintView({
  fechaInicio,
  fechaTermino,
  fechaGeneracion,
  items,
  resumen,
  usuario,
}: ReporteMermasPrintViewProps): ReactElement {
  return (
    <main className="waste-report-print-view">
      <header>
        <h1>Minimarket y Panadería Huáscar</h1>
        <h2>Reporte de mermas</h2>
        <dl className="report-metadata">
          <div>
            <dt>Período</dt>
            <dd>
              {fechaInicio} al {fechaTermino}
            </dd>
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
              <th>Total unidades</th>
              <th>Costo total</th>
              <th>Por vencimiento</th>
              <th>Por daño</th>
              <th>Por robo</th>
              <th>Por error registro</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                {resumen.totalUnidades}
              </td>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                ${resumen.costoTotal.toLocaleString("es-CL")}
              </td>
              <td className="numeric">{resumen.unidadesPorMotivo.vencimiento}</td>
              <td className="numeric">{resumen.unidadesPorMotivo.dano}</td>
              <td className="numeric">{resumen.unidadesPorMotivo.robo}</td>
              <td className="numeric">{resumen.unidadesPorMotivo.error_registro}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <table>
        <thead>
          <tr>
            <th>Fecha y hora</th>
            <th>Producto</th>
            <th>EAN-13</th>
            <th>Categoría</th>
            <th>Cantidad</th>
            <th>Motivo</th>
            <th>Costo unitario</th>
            <th>Costo total</th>
            <th>Responsable</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.fechaHora}</td>
              <td>{item.productoNombre}</td>
              <td>{item.productoEan13}</td>
              <td>{item.categoriaNombre}</td>
              <td className="numeric">{item.cantidad}</td>
              <td>{MOTIVO_LABELS[item.motivo] ?? item.motivo}</td>
              <td className="numeric">
                ${item.costoUnitario.toLocaleString("es-CL")}
              </td>
              <td className="numeric">
                ${item.costoTotal.toLocaleString("es-CL")}
              </td>
              <td>{item.usuarioNombre}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
