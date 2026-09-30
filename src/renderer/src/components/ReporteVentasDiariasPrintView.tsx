import type { ReactElement } from "react";
import type { DailySalesReport } from "../../../shared/reports";

export type DailySalesPrintInput = {
  report: DailySalesReport;
  generatedAt: string;
  usuario: string;
};

const money = (value: number): string => `$${value.toLocaleString("es-CL")}`;
const dateLabel = (fecha: string): string => fecha.split("-").reverse().join("/");
const timeLabel = (fechaHora: string): string => {
  const iso = fechaHora.includes("T") ? fechaHora : fechaHora.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }).format(date);
};

export function ReporteVentasDiariasPrintView({ report, generatedAt, usuario }: DailySalesPrintInput): ReactElement {
  const methods = ["efectivo", "debito", "credito", "transferencia"] as const;
  return <main>
    <h1>Minimarket y Panadería Huáscar</h1>
    <h2>Reporte diario de ventas</h2>
    <p><strong>Período:</strong> {dateLabel(report.fecha)} · <strong>Generado:</strong> {generatedAt} · <strong>Usuario:</strong> {usuario}</p>
    <h3>Resumen de ventas vigentes</h3>
    <p>{report.resumen.ventasVigentes} ventas · {money(report.resumen.montoVigente)}</p>
    <table><thead><tr><th>Método de pago</th><th>Cantidad</th><th>Monto</th></tr></thead><tbody>
      {methods.map((method) => <tr key={method}><td>{method}</td><td>{report.resumen.porMetodoPago[method].cantidad}</td><td>{money(report.resumen.porMetodoPago[method].monto)}</td></tr>)}
    </tbody></table>
    <h3>Ventas anuladas</h3>
    <p>{report.resumen.ventasAnuladas} ventas · {money(report.resumen.montoAnulado)}</p>
    <h3>Top 5 productos por unidades</h3>
    <table><thead><tr><th>Producto</th><th>EAN-13</th><th>Unidades</th><th>Ingreso neto</th></tr></thead><tbody>
      {report.topProductos.map((item) => <tr key={item.productoId}><td>{item.nombre}</td><td>{item.ean13}</td><td>{item.unidades}</td><td>{money(item.montoNeto)}</td></tr>)}
    </tbody></table>
    <h3>Estado de caja</h3>
    <p>{report.caja.estado}{report.caja.fechaHoraCierre ? ` · cierre ${timeLabel(report.caja.fechaHoraCierre)}` : ""}</p>
    <h3>Listado de ventas</h3>
    <table><thead><tr><th>Número</th><th>Hora</th><th>Responsable</th><th>Estado</th><th>Método</th><th>Total</th></tr></thead><tbody>
      {report.ventas.map((sale) => <tr key={sale.ventaId}><td>{sale.ventaId}</td><td>{timeLabel(sale.fechaHora)}</td><td>{sale.responsable.nombre}</td><td>{sale.estado}</td><td>{sale.metodoPago}</td><td>{money(sale.total)}</td></tr>)}
    </tbody></table>
  </main>;
}
