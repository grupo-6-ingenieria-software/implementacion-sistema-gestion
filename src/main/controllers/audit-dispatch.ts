import type { ControllerResponse } from "../../shared/controllers";
import { MONTHLY_SALES_REPORT_TYPE } from "../../shared/monthly-sales";
import { PRODUCTS_MOST_SOLD_REPORT_TYPE } from "../../shared/products-most-sold";
import { CATEGORY_PROFITABILITY_REPORT_TYPE } from "../../shared/category-profitability";
import { controllerError, type ControllerContext, type RegisteredController } from "./base";

// Las mutaciones y la consulta del propio log ya se auditan en sus servicios.
// Las lecturas de negocio se registran aquí usando la identidad del dispatcher.
export const AUDITED_QUERY_CHANNELS: ReadonlySet<string> = new Set([
  "reporte:ventas-mensuales",
  "reporte:rentabilidad-categoria",
  "reporte:productos-mas-vendidos",
  "dashboard:cargar", "dashboard:alertas-stock", "dashboard:alertas-vencimiento",
  "dashboard:total-ventas-dia", "producto:listar", "producto:buscar-activo",
  "producto:estado", "producto:buscar", "producto:detalle-lotes", "lote:proveedores",
  "merma:disponibilidad", "venta:producto", "venta:verificar-caja",
  "venta:historial-dia", "venta:buscar", "venta:detalle", "caja:resumen-cierre",
  "caja:verificar-disponible", "trabajador:listar", "trabajador:listar-activos",
  "turno:listar", "asistencia:resumen-dashboard", "usuario:listar",
  "ajuste:disponibilidad", "movimiento:historial", "remuneracion:trabajadores-elegibles",
  "configuracion:previsional-obtener", "pedido:listar", "pedido:detalle",
  "proveedor:categorias", "proveedor:listar", "proveedor:buscar-existente",
  "inventario:lista-reabastecimiento", "inventario:valorizacion",
  "reporte:ventas-diarias",
  "asistencia:resumen-mensual", "trabajador:listar-para-resumen",
]);

export type DispatchAuditEvent = {
  descripcion: string;
  modulo: string;
  tipoAccion: string;
  usuarioId: string;
};

export async function handleWithAudit(
  controller: RegisteredController<any, any>,
  payload: unknown,
  context: ControllerContext,
  audit: (event: DispatchAuditEvent) => Promise<void>,
): Promise<ControllerResponse> {
  const response = await controller.handle(payload, context);
  if (!response.ok || !context.claims) return response;

  const isQuery = AUDITED_QUERY_CHANNELS.has(context.channel);
  const isInventoryExport = context.channel === "inventario:reabastecimiento:exportar-pdf" ||
    context.channel === "inventario:reabastecimiento:exportar-xlsx";
  const reportType = (payload as { tipo?: unknown } | null)?.tipo;
  const isSalesExport = (context.channel === "reporte:exportar-pdf" ||
    context.channel === "reporte:exportar-xlsx") &&
    (reportType === MONTHLY_SALES_REPORT_TYPE || reportType === PRODUCTS_MOST_SOLD_REPORT_TYPE ||
      reportType === CATEGORY_PROFITABILITY_REPORT_TYPE);
  const isExport = isInventoryExport || isSalesExport;
  // Cerrar el diálogo sin guardar no es una exportación realizada.
  if (!isQuery && !(isExport && response.data?.estado === "saved")) return response;

  try {
    await audit({
      descripcion: `${isQuery ? "Consulta" : "Exportación"} realizada mediante ${context.channel}.`,
      modulo: controller.metadata.module,
      tipoAccion: isQuery ? "consulta" : "exportacion",
      usuarioId: context.claims.usuarioId,
    });
  } catch {
    return controllerError(
      "DATABASE_ERROR",
      isExport
        ? "El archivo fue guardado, pero no fue posible registrar su auditoría."
        : "No fue posible registrar la auditoría de la consulta. Intente nuevamente.",
      controller.metadata.id,
    );
  }
  return response;
}
