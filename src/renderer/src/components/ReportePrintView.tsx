import type { ReactElement } from "react";
import {
  INVENTORY_EXPORT_COLUMNS,
  type InventoryReportInput,
} from "../../../shared/inventory-export";

const currency = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

/** UI07: composición interna de CU20, renderizada por Main para imprimir. */
export function ReportePrintView(input: InventoryReportInput): ReactElement {
  return (
    <main>
      <header>
        <h1>{input.negocio}</h1>
        <h2>Listado de inventario</h2>
        <dl className="report-metadata">
          <div>
            <dt>Fecha de exportación</dt>
            <dd>{input.fecha}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{input.usuario}</dd>
          </div>
        </dl>
      </header>
      <table>
        <colgroup>
          {[14, 22, 15, 9, 9, 11, 11, 9].map((width, index) => (
            <col key={index} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {INVENTORY_EXPORT_COLUMNS.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.items.map((item) => (
            <tr key={item.productoId}>
              <td className="ean">{item.ean13}</td>
              <td>{item.nombre}</td>
              <td>{item.categoria}</td>
              <td className="numeric">{item.stockActual}</td>
              <td className="numeric">{item.stockMinimo}</td>
              <td className="numeric">{currency.format(item.precioCosto)}</td>
              <td className="numeric">{currency.format(item.precioVenta)}</td>
              <td>{item.estado}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
