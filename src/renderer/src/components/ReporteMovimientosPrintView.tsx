import type { ReactElement } from "react";
import type {
  MovementReportItem,
  MovementReportSummary,
} from "../../../shared/report-movements";

export type ReporteMovimientosPrintViewProps = {
  fechaInicio: string;
  fechaTermino: string;
  tipoNombre?: string;
  categoriaNombre?: string;
  usuarioFiltroNombre?: string;
  fechaGeneracion: string;
  items: readonly MovementReportItem[];
  resumen: MovementReportSummary;
  usuario: string;
};

export function ReporteMovimientosPrintView({
  fechaInicio,
  fechaTermino,
  tipoNombre,
  categoriaNombre,
  usuarioFiltroNombre,
  fechaGeneracion,
  items,
  resumen,
  usuario,
}: ReporteMovimientosPrintViewProps): ReactElement {
  return (
    <main className="movement-report-print-view">
      <header>
        <h1>Minimarket y Panadería Huáscar</h1>
        <h2>Reporte de auditoría de movimientos de inventario</h2>
        <dl className="report-metadata">
          <div>
            <dt>Período</dt>
            <dd>
              {fechaInicio} al {fechaTermino}
            </dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{tipoNombre ?? "Todos"}</dd>
          </div>
          <div>
            <dt>Categoría</dt>
            <dd>{categoriaNombre ?? "Todas"}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{usuarioFiltroNombre ?? "Todos"}</dd>
          </div>
          <div>
            <dt>Fecha de generación</dt>
            <dd>{fechaGeneracion}</dd>
          </div>
          <div>
            <dt>Generado por</dt>
            <dd>{usuario}</dd>
          </div>
        </dl>
      </header>

      <section className="report-summary" style={{ marginBottom: "16px" }}>
        <table style={{ width: "100%", marginBottom: "16px" }}>
          <thead>
            <tr>
              <th>Total movimientos</th>
              <th>Total entradas</th>
              <th>Total salidas</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                {resumen.totalMovimientos}
              </td>
              <td className="numeric" style={{ fontWeight: "bold", color: "#1b4332" }}>
                +{resumen.totalEntradas}
              </td>
              <td className="numeric" style={{ fontWeight: "bold", color: "#c0392b" }}>
                -{resumen.totalSalidas}
              </td>
            </tr>
          </tbody>
        </table>

        {resumen.resumenPorTipo.length > 0 && (
          <table style={{ width: "100%", marginBottom: "16px" }}>
            <thead>
              <tr>
                <th>Tipo de movimiento</th>
                <th>Movimientos</th>
                <th>Unidades</th>
              </tr>
            </thead>
            <tbody>
              {resumen.resumenPorTipo.map((rt) => (
                <tr key={rt.tipo}>
                  <td>{rt.tipoLabel}</td>
                  <td className="numeric">{rt.totalMovimientos}</td>
                  <td className="numeric">{rt.totalUnidades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <table>
        <thead>
          <tr>
            <th>Fecha y hora</th>
            <th>Producto</th>
            <th>EAN-13</th>
            <th>Categoría</th>
            <th>Tipo</th>
            <th>Cantidad</th>
            <th>Saldo</th>
            <th>Lote</th>
            <th>Descripción</th>
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
              <td>{item.tipoLabel}</td>
              <td
                className="numeric"
                style={{
                  fontWeight: "bold",
                  color: item.cantidad > 0 ? "#1b4332" : "#c0392b",
                }}
              >
                {item.cantidad > 0 ? `+${item.cantidad}` : item.cantidad}
              </td>
              <td className="numeric" style={{ fontWeight: "bold" }}>
                {item.saldo}
              </td>
              <td style={{ fontFamily: "monospace", fontSize: "8pt" }}>
                {item.loteId ? item.loteId.slice(0, 8) : "-"}
              </td>
              <td>{item.descripcion}</td>
              <td>{item.usuarioNombre}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
