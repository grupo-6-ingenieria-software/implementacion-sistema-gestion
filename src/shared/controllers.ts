import type { ControllerId } from "./navigation";

export type ControllerModule =
  | "auth"
  | "dashboard"
  | "inventario"
  | "proveedores"
  | "ventas"
  | "caja"
  | "personal"
  | "administracion"
  | "lector-ean";

export type ControllerMetadata = {
  id: ControllerId;
  name: string;
  module: ControllerModule;
  channels: readonly string[];
};

export type ControllerRequest<TPayload = unknown> = {
  channel: string;
  payload?: TPayload;
};

export type ControllerErrorCode =
  | "NOT_IMPLEMENTED"
  | "INVALID_CHANNEL"
  | "DATABASE_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "BUSINESS_RULE"
  | "TECHNICAL_ERROR";

export type ControllerResponse<TData = unknown> =
  | { ok: true; data: TData }
  | {
      ok: false;
      error: {
        code: ControllerErrorCode;
        message: string;
        controllerId?: ControllerId;
        fieldErrors?: Partial<Record<string, string>>;
      };
    };

export const controllers = [
  {
    id: "auth-login",
    name: "AuthHandler",
    module: "auth",
    channels: ["auth:login"],
  },
  {
    id: "password",
    name: "PasswordHandler",
    module: "auth",
    channels: ["auth:cambiar-password", "auth:restablecer-password"],
  },
  {
    id: "access-control",
    name: "ControlAccesoMiddleware",
    module: "auth",
    channels: ["access:validate"],
  },
  {
    id: "audit",
    name: "AuditoriaHandler",
    module: "auth",
    channels: ["auditoria:registrar", "auditoria:consultar"],
  },
  {
    id: "session",
    name: "SesionHandler",
    module: "auth",
    channels: ["auth:verificar-sesion", "auth:logout"],
  },
  {
    id: "dashboard",
    name: "DashboardHandler",
    module: "dashboard",
    channels: ["dashboard:cargar"],
  },
  {
    id: "stock-alert",
    name: "AlertaStockHandler",
    module: "dashboard",
    channels: ["dashboard:alertas-stock"],
  },
  {
    id: "expiration-alert",
    name: "AlertaVencimientoHandler",
    module: "dashboard",
    channels: ["dashboard:alertas-vencimiento"],
  },
  {
    id: "daily-sales-total",
    name: "TotalVentasDiaHandler",
    module: "dashboard",
    channels: ["dashboard:total-ventas-dia"],
  },
  {
    id: "product-create",
    name: "RegistrarProductoHandler",
    module: "inventario",
    channels: ["producto:registrar"],
  },
  {
    id: "product-edit",
    name: "EditarProductoHandler",
    module: "inventario",
    channels: ["producto:editar"],
  },
  {
    id: "product-status",
    name: "CambiarEstadoProductoHandler",
    module: "inventario",
    channels: ["producto:cambiar-estado"],
  },
  {
    id: "product-query",
    name: "ConsultaProductoHandler",
    module: "inventario",
    channels: [
      "producto:listar",
      "producto:buscar-activo",
      "producto:estado",
      "producto:buscar",
    ],
  },
  {
    id: "lot",
    name: "LoteHandler",
    module: "inventario",
    channels: ["lote:registrar", "lote:proveedores"],
  },
  {
    id: "waste",
    name: "MermaHandler",
    module: "inventario",
    channels: ["merma:registrar", "merma:disponibilidad"],
  },
  {
    id: "sale",
    name: "VentaHandler",
    module: "ventas",
    channels: [
      "venta:registrar",
      "venta:producto",
      "venta:verificar-caja",
      "venta:validar-carrito",
    ],
  },
  {
    id: "stock-discount",
    name: "DescuentoStockHandler",
    module: "ventas",
    channels: ["stock:descontar"],
  },
  {
    id: "sales-history",
    name: "HistorialVentasHandler",
    module: "ventas",
    channels: ["venta:historial-dia", "venta:buscar", "venta:detalle"],
  },
  {
    id: "cash-closing",
    name: "CierreCajaHandler",
    module: "caja",
    channels: ["caja:resumen-cierre", "caja:cerrar"],
  },
  {
    id: "cash-check",
    name: "VerificacionCajaHandler",
    module: "caja",
    channels: ["caja:verificar-disponible"],
  },
  {
    id: "worker",
    name: "TrabajadorHandler",
    module: "personal",
    channels: [
      "trabajador:listar",
      "trabajador:registrar",
      "trabajador:actualizar",
      "trabajador:cambiar-estado",
      "trabajador:listar-activos",
    ],
  },
  {
    id: "shift",
    name: "TurnoHandler",
    module: "personal",
    channels: ["turno:crear", "turno:listar", "turno:editar", "turno:eliminar"],
  },
  {
    id: "attendance",
    name: "AsistenciaHandler",
    module: "personal",
    channels: [
      "asistencia:entrada",
      "asistencia:entrada-sin-turno",
      "asistencia:salida",
      "asistencia:resumen-dashboard",
    ],
  },
  {
    id: "ean-reader",
    name: "LectorEANHandler",
    module: "lector-ean",
    channels: ["ean:validar-captura"],
  },
  {
    id: "user-management",
    name: "GestionUsuariosHandler",
    module: "administracion",
    channels: ["usuario:listar", "usuario:solicitar-restablecimiento"],
  },
  {
    id: "product-delete",
    name: "EliminarProductoHandler",
    module: "inventario",
    channels: ["producto:eliminar"],
  },
  {
    id: "sale-annulment",
    name: "AnulacionVentaHandler",
    module: "ventas",
    channels: ["venta:anular"],
  },
  {
    id: "product-detail",
    name: "DetalleProductoHandler",
    module: "inventario",
    channels: ["producto:detalle-lotes"],
  },
  {
    id: "stock-adjustment",
    name: "AjusteStockHandler",
    module: "inventario",
    channels: ["ajuste:registrar", "ajuste:disponibilidad"],
  },
  {
    id: "movement-history",
    name: "HistorialMovimientosHandler",
    module: "inventario",
    channels: ["movimiento:historial"],
  },
  {
    id: "remuneracion",
    name: "RemuneracionHandler",
    module: "personal",
    channels: ["remuneracion:registrar", "remuneracion:trabajadores-elegibles"],
  },
  {
    id: "configuracion-previsional",
    name: "ConfigPrevisionalHandler",
    module: "personal",
    channels: [
      "configuracion:previsional-obtener",
      "configuracion:previsional-actualizar",
    ],
  },
  {
    id: "supplier-order",
    name: "PedidoProveedorHandler",
    module: "proveedores",
    channels: ["pedido:registrar"],
  },
  {
    id: "supplier-order-reception",
    name: "RecepcionPedidoHandler",
    module: "proveedores",
    channels: [
      "pedido:listar",
      "pedido:detalle",
      "pedido:confirmar-recepcion",
      "pedido:cancelar",
      "pedido:cerrar-saldo",
    ],
  },
  {
    id: "supplier-create",
    name: "RegistrarProveedorHandler",
    module: "proveedores",
    channels: ["proveedor:categorias", "proveedor:registrar"],
  },
  {
    id: "supplier-query",
    name: "ConsultaProveedorHandler",
    module: "proveedores",
    channels: ["proveedor:listar", "proveedor:buscar-existente"],
  },
  {
    id: "supplier-edit",
    name: "EditarProveedorHandler",
    module: "proveedores",
    channels: ["proveedor:editar"],
  },
  {
    id: "restock-list",
    name: "ReabastecimientoHandler",
    module: "inventario",
    channels: ["inventario:lista-reabastecimiento"],
  },
  {
    id: "restock-report-export",
    name: "ExportacionReporteHandler",
    module: "inventario",
    channels: ["reporte:exportar-pdf", "reporte:exportar-xlsx"],
  },
] as const satisfies readonly ControllerMetadata[];

export const controllerIds = controllers.map((controller) => controller.id);
export const ipcChannels = controllers.flatMap((controller) =>
  controller.channels.map((channel) => ({
    channel,
    controllerId: controller.id,
  })),
);

export function findControllerById(
  id: ControllerId,
): ControllerMetadata | undefined {
  return controllers.find((controller) => controller.id === id);
}

export function findControllerByChannel(
  channel: string,
): ControllerMetadata | undefined {
  return controllers.find((controller) =>
    (controller.channels as readonly string[]).includes(channel),
  );
}
