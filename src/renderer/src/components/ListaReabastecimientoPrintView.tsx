import type { ReactElement } from "react";
import type { RestockItem } from "../../../shared/restock";

export type ListaReabastecimientoPrintViewProps = {
  fecha: string;
  items: readonly RestockItem[];
  usuario: string;
};

export function ListaReabastecimientoPrintView({
  fecha,
  items,
  usuario,
}: ListaReabastecimientoPrintViewProps): ReactElement {
  return (
    <main className="restock-print-view">
      <header>
        <h1>Minimarket y Panadería Huáscar</h1>
        <h2>Lista de reabastecimiento</h2>
        <dl className="report-metadata">
          <div>
            <dt>Fecha de generación</dt>
            <dd>{fecha}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{usuario}</dd>
          </div>
        </dl>
      </header>

      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>EAN-13</th>
            <th>Categoría</th>
            <th>Stock actual</th>
            <th>Stock mínimo</th>
            <th>Cantidad sugerida</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.ean13}>
              <td>{item.nombre}</td>
              <td>{item.ean13}</td>
              <td>{item.categoria}</td>
              <td className="numeric">{item.stockActual}</td>
              <td className="numeric">{item.stockMinimo}</td>
              <td className="numeric">{item.cantidadSugerida}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
