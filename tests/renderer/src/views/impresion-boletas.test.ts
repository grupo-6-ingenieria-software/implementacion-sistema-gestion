import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isImplementedViewNodeId } from "../../../../src/renderer/src/App";
import {
  ComprobanteVentaCategoria,
  type ReceiptPrintStatus,
} from "../../../../src/renderer/src/views/SaleRegisterView";
import { navigationTree } from "../../../../src/shared/navigation";
import type { SaleReceipt } from "../../../../src/shared/sales";

const receipt: SaleReceipt = {
  ventaId: "00000000-0000-4000-8000-000000000901",
  fechaHora: "2026-10-11T20:00:00.000Z",
  responsable: { usuarioId: "11111111-1", nombre: "María Huáscar", rol: "dueno" },
  metodoPago: "efectivo",
  subtotal: 1000,
  descuento: { tipo: "ninguno", valor: 0 },
  total: 1000,
  montoRecibido: 2000,
  vuelto: 1000,
  detalle: [
    {
      productoId: 1, ean13: "7802920000015", nombre: "Pan", categoria: "Abarrotes",
      precioUnitario: 1000, historialPrecioProductoId: "h1", stockDisponible: 4,
      exigeVencimiento: false, cantidad: 1, subtotal: 1000, lotesConsumidos: [],
    },
  ],
};

function render(printStatus: ReceiptPrintStatus | null): string {
  return renderToStaticMarkup(
    createElement(ComprobanteVentaCategoria, { receipt, printStatus, onPrint: () => undefined }),
  );
}

describe("estado de impresión en el comprobante de V12", () => {
  it("muestra la boleta impresa y la acción de reimprimir", () => {
    const markup = render({ state: "printed", copia: false });
    expect(markup).toContain("Boleta impresa");
    expect(markup).toContain("Reimprimir boleta");
    expect(markup).not.toContain("Reintentar impresión");
  });

  it("si la impresora falla conserva la venta y ofrece reintentar en vez de reimprimir", () => {
    const markup = render({ state: "failed", copia: false, message: "No fue posible imprimir la boleta." });
    expect(markup).toContain("No impresa");
    expect(markup).toContain("La venta fue registrada. No fue posible imprimir la boleta.");
    expect(markup).toContain("Reintentar impresión");
    expect(markup).not.toContain("Reimprimir boleta");
  });

  it("deshabilita la reimpresión mientras imprime", () => {
    const markup = render({ state: "printing", copia: true });
    expect(markup).toContain("Imprimiendo...");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Reimprimir boleta<\/button>/);
  });

  it("confirma la copia enviada a la impresora", () => {
    expect(render({ state: "printed", copia: true })).toContain("Copia de la boleta enviada a la impresora.");
  });

  it("sin estado de impresión conserva el comprobante existente con rol del responsable", () => {
    const markup = renderToStaticMarkup(createElement(ComprobanteVentaCategoria, { receipt }));
    expect(markup).toContain("Comprobante");
    expect(markup).toContain("Dueño");
    expect(markup).not.toContain("Reimprimir boleta");
  });
});

describe("navegación", () => {
  it("Registrar venta y Consulta de ventas usan el controlador de impresión y no existe vista de configuración", () => {
    const saleNodes = navigationTree.filter((item) => item.id === "sale-register" || item.id === "sales-query");
    expect(saleNodes).toHaveLength(2);
    for (const item of saleNodes) expect(item.controllerIds).toContain("receipt-print");
    expect(navigationTree.map((item): string => item.id)).not.toContain("printer-config");
    expect(isImplementedViewNodeId("printer-config")).toBe(false);
  });
});
