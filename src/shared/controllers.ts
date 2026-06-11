import type { ControllerId } from './navigation';

export type ControllerModule =
  | 'auth'
  | 'dashboard'
  | 'inventario'
  | 'ventas'
  | 'caja'
  | 'personal'
  | 'lector-ean';

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

export type ControllerErrorCode = 'NOT_IMPLEMENTED' | 'INVALID_CHANNEL';

export type ControllerResponse<TData = unknown> =
  | { ok: true; data: TData }
  | {
      ok: false;
      error: {
        code: ControllerErrorCode;
        message: string;
        controllerId?: ControllerId;
      };
    };

export const controllers = [
  {
    id: 'auth-login',
    name: 'AuthHandler',
    module: 'auth',
    channels: ['auth:login'],
  },
  {
    id: 'password',
    name: 'PasswordHandler',
    module: 'auth',
    channels: ['auth:cambiar-password', 'auth:restablecer-password'],
  },
  {
    id: 'access-control',
    name: 'ControlAccesoMiddleware',
    module: 'auth',
    channels: ['access:validate'],
  },
  {
    id: 'audit',
    name: 'AuditoriaHandler',
    module: 'auth',
    channels: ['auditoria:registrar', 'auditoria:consultar'],
  },
  {
    id: 'session',
    name: 'SesionHandler',
    module: 'auth',
    channels: ['auth:verificar-sesion'],
  },
  {
    id: 'dashboard',
    name: 'DashboardHandler',
    module: 'dashboard',
    channels: ['dashboard:cargar'],
  },
  {
    id: 'stock-alert',
    name: 'AlertaStockHandler',
    module: 'dashboard',
    channels: ['dashboard:alertas-stock'],
  },
  {
    id: 'expiration-alert',
    name: 'AlertaVencimientoHandler',
    module: 'dashboard',
    channels: ['dashboard:alertas-vencimiento'],
  },
  {
    id: 'daily-sales-total',
    name: 'TotalVentasDiaHandler',
    module: 'dashboard',
    channels: ['dashboard:total-ventas-dia'],
  },
  {
    id: 'product-create',
    name: 'RegistrarProductoHandler',
    module: 'inventario',
    channels: ['producto:registrar'],
  },
  {
    id: 'product-edit',
    name: 'EditarProductoHandler',
    module: 'inventario',
    channels: ['producto:editar'],
  },
  {
    id: 'product-status',
    name: 'CambiarEstadoProductoHandler',
    module: 'inventario',
    channels: ['producto:cambiar-estado'],
  },
  {
    id: 'product-query',
    name: 'ConsultaProductoHandler',
    module: 'inventario',
    channels: ['producto:listar', 'producto:buscar-activo', 'producto:estado'],
  },
  {
    id: 'lot',
    name: 'LoteHandler',
    module: 'inventario',
    channels: ['lote:registrar'],
  },
  {
    id: 'waste',
    name: 'MermaHandler',
    module: 'inventario',
    channels: ['merma:registrar'],
  },
  {
    id: 'sale',
    name: 'VentaHandler',
    module: 'ventas',
    channels: ['venta:registrar'],
  },
  {
    id: 'stock-discount',
    name: 'DescuentoStockHandler',
    module: 'ventas',
    channels: ['stock:descontar'],
  },
  {
    id: 'sales-history',
    name: 'HistorialVentasHandler',
    module: 'ventas',
    channels: ['venta:historial-dia'],
  },
  {
    id: 'cash-closing',
    name: 'CierreCajaHandler',
    module: 'caja',
    channels: ['caja:resumen-cierre', 'caja:cerrar'],
  },
  {
    id: 'cash-check',
    name: 'VerificacionCajaHandler',
    module: 'caja',
    channels: ['caja:verificar-disponible'],
  },
  {
    id: 'worker',
    name: 'TrabajadorHandler',
    module: 'personal',
    channels: ['trabajador:registrar', 'trabajador:listar-activos'],
  },
  {
    id: 'shift',
    name: 'TurnoHandler',
    module: 'personal',
    channels: ['turno:crear', 'turno:listar'],
  },
  {
    id: 'attendance',
    name: 'AsistenciaHandler',
    module: 'personal',
    channels: [
      'asistencia:entrada',
      'asistencia:entrada-sin-turno',
      'asistencia:salida',
      'asistencia:resumen-dashboard',
    ],
  },
  {
    id: 'ean-reader',
    name: 'LectorEANHandler',
    module: 'lector-ean',
    channels: ['ean:validar-captura'],
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
