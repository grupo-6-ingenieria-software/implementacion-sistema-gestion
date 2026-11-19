import type { ReceiptPrintResult } from "../../shared/receipt-print";
import type { DailyCashState, SaleCartValidationResult, SaleReceipt } from "../../shared/sales";
import type { SupplierOrderDetail, SupplierOrderListItem, SupplierOrderReceptionResponse } from "../../shared/supplier-orders";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });
const formatMoney = (value: number): string => money.format(value);
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const cashLabels: Record<DailyCashState["status"], string> = {
  sin_registro: "Caja disponible; se abre con la primera venta",
  abierta: "Caja abierta",
  cerrada: "Caja cerrada",
};

type ActiveProduct = { nombre: string; stockDisponible: number; precioVenta: number };

/** Resumen de una línea para el retorno handler → vista en la traza de la demo. */
export function summarizeDemoResponse(channel: string, data: unknown): string {
  try {
    switch (channel) {
      case "pedido:listar":
        return `${plural((data as SupplierOrderListItem[]).length, "pedido", "pedidos")} por estado`;
      case "pedido:detalle": {
        const detail = data as SupplierOrderDetail;
        return `Pedido ${detail.estado}: ${plural(detail.lineas.length, "línea", "líneas")} con saldos e historial`;
      }
      case "pedido:confirmar-recepcion": {
        const result = data as SupplierOrderReceptionResponse;
        return result.idempotente
          ? "Entrega ya registrada; sin cambios"
          : `Entrega registrada; pedido ${result.estado}`;
      }
      case "venta:verificar-caja":
        return cashLabels[(data as DailyCashState).status];
      case "venta:producto": {
        const products = data as ActiveProduct[];
        if (products.length !== 1) return `${plural(products.length, "producto activo", "productos activos")}`;
        const [product] = products;
        return `${product.nombre} · ${formatMoney(product.precioVenta)} · stock ${product.stockDisponible}`;
      }
      case "venta:validar-carrito":
        return `Carrito válido · subtotal ${formatMoney((data as SaleCartValidationResult).subtotal)}`;
      case "boleta:imprimir":
        return (data as ReceiptPrintResult).copia ? "Copia enviada a impresión" : "Boleta enviada a impresión";
      case "venta:registrar": {
        const receipt = data as SaleReceipt;
        const change = receipt.vuelto !== undefined ? ` · vuelto ${formatMoney(receipt.vuelto)}` : "";
        return `Venta registrada · ${receipt.metodoPago} · total ${formatMoney(receipt.total)}${change}`;
      }
    }
  } catch {
    // Un resumen incompleto no debe afectar la respuesta.
  }
  return "Respuesta OK";
}
