import type { ControllerResponse } from "../../shared/controllers";
import { isReportExportRequest } from "../../shared/monthly-sales";
import { controllerError, type ControllerContext, type RegisteredController } from "./base";

// Las mutaciones y la consulta del propio log ya se auditan en sus servicios.
// Las lecturas de negocio se registran aquí usando la identidad del dispatcher.
export const AUDITED_QUERY_CHANNELS: ReadonlySet<string> = new Set([
  "reporte:ventas-mensuales",
  "reporte:rentabilidad-categoria",
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
  const isExport = context.channel === "reporte:exportar-pdf" ||
    context.channel === "reporte:exportar-xlsx";
  // Cerrar el diálogo sin guardar no es una exportación realizada.
  if (!isQuery && !(isExport && response.data?.estado === "saved")) return response;

  try {
    await audit({
      descripcion: `${isQuery ? "Consulta" : "Exportación"} realizada mediante ${context.channel}.`,
      modulo: isReportExportRequest(context.channel, payload) ? "reportes" : controller.metadata.module,
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
