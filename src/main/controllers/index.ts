import type { IpcMain } from "electron";
import { findControllerByChannel } from "../../shared/controllers";
import { db, schema as appSchema } from "../../db/client";
import { authorizeRequest } from "./ValidacionAccesoAuxiliar";
import { handleWithAudit } from "./DespachoAuditoriaAuxiliar";
import { registerAuditLog } from "./ContextoAutenticacionAuxiliar";
import { SESSION_EXPIRED_EVENT } from "../../shared/auth";
import { notifySessionInvalidated } from "./EventosSesionAuxiliar";
import { controlAcceso } from "./ControlAcceso";
import { asistenciaHandler } from "./AsistenciaHandler";
import { reporteAsistenciaHandler } from "./ReporteAsistenciaHandler";
import { auditoriaHandler } from "./AuditoriaHandler";
import { authHandler } from "./AuthHandler";
import { verificacionCajaHandler } from "./VerificacionCajaHandler";
import { cierreCajaHandler } from "./CierreCajaHandler";
import { configPrevisionalHandler } from "./ConfigPrevisionalHandler";
import { totalVentasDiaHandler } from "./TotalVentasDiaHandler";
import { dashboardHandler } from "./DashboardHandler";
import { lectorEANHandler } from "./LectorEANHandler";
import { alertaVencimientoHandler } from "./AlertaVencimientoHandler";
import { loteHandler } from "./LoteHandler";
import { createPasswordHandler } from "./PasswordHandler";
import { registrarProductoHandler } from "./RegistrarProductoHandler";
import { eliminarProductoHandler } from "./EliminarProductoHandler";
import { editarProductoHandler } from "./EditarProductoHandler";
import { consultaProductoHandler } from "./ConsultaProductoHandler";
import { cambiarEstadoProductoHandler } from "./CambiarEstadoProductoHandler";
import { remuneracionHandler } from "./RemuneracionHandler";
import { ventaHandler } from "./VentaHandler";
import { categoriaVentaHandler } from "./CategoriaVentaHandler";
import { anulacionVentaHandler } from "./AnulacionVentaHandler";
import { historialVentasHandler } from "./HistorialVentasHandler";
import { sesionHandler } from "./SesionHandler";
import { turnoHandler } from "./TurnoHandler";
import { alertaStockHandler } from "./AlertaStockHandler";
import { descuentoStockHandler } from "./DescuentoStockHandler";
import { pedidoProveedorHandler } from "./PedidoProveedorHandler";
import { recepcionPedidoHandler } from "./RecepcionPedidoHandler";
import { registrarProveedorHandler } from "./RegistrarProveedorHandler";
import { editarProveedorHandler } from "./EditarProveedorHandler";
import { consultaProveedorHandler } from "./ConsultaProveedorHandler";
import { historialMovimientosHandler } from "./HistorialMovimientosHandler";
import { detalleProductoHandler } from "./DetalleProductoHandler";
import { ajusteStockHandler } from "./AjusteStockHandler";
import { mermaHandler } from "./MermaHandler";
import {
  changeStatusWithExecutor,
  createTrabajadorHandler,
  workerDependencies,
} from "./TrabajadorHandler";
import { reabastecimientoHandler } from "./ReabastecimientoHandler";
import { exportacionReporteHandler } from "./ExportacionReporteHandler";
import { reporteVentasMensualHandler } from "./ReporteVentasMensualHandler";
import { reporteRentabilidadHandler } from "./ReporteRentabilidadHandler";
import { reporteProductosMasVendidosHandler } from "./ReporteProductosMasVendidosHandler";
import { valorizacionHandler } from "./ValorizacionHandler";
import { reporteVentasDiaHandler } from "./ReporteVentasDiaHandler";
import { reporteMermasHandler } from "./ReporteMermasHandler";
import { reporteLotesPorVencerHandler } from "./ReporteLotesPorVencerHandler";
import { reporteMovimientosHandler } from "./ReporteMovimientosHandler";
import { impresionBoletaHandler } from "./ImpresionBoletaHandler";
import type { RegisteredController } from "./BaseControladorAuxiliar";

const trabajadorHandler = createTrabajadorHandler({
  ...workerDependencies,
  changeStatus: (payload, sesionRol) =>
    changeStatusWithExecutor(
      db,
      appSchema,
      payload,
      sesionRol,
      notifySessionInvalidated,
    ),
});

const passwordHandler = createPasswordHandler({}, notifySessionInvalidated);

export const registeredControllers: readonly RegisteredController<any, any>[] =
  [
    authHandler,
    passwordHandler,
    controlAcceso,
    auditoriaHandler,
    sesionHandler,
    dashboardHandler,
    alertaStockHandler,
    alertaVencimientoHandler,
    totalVentasDiaHandler,
    registrarProductoHandler,
    editarProductoHandler,
    cambiarEstadoProductoHandler,
    consultaProductoHandler,
    loteHandler,
    mermaHandler,
    ventaHandler,
    descuentoStockHandler,
    historialVentasHandler,
    cierreCajaHandler,
    verificacionCajaHandler,
    trabajadorHandler,
    turnoHandler,
    asistenciaHandler,
    lectorEANHandler,
    eliminarProductoHandler,
    anulacionVentaHandler,
    detalleProductoHandler,
    ajusteStockHandler,
    historialMovimientosHandler,
    remuneracionHandler,
    configPrevisionalHandler,
    pedidoProveedorHandler,
    recepcionPedidoHandler,
    registrarProveedorHandler,
    consultaProveedorHandler,
    editarProveedorHandler,
    reabastecimientoHandler,
    valorizacionHandler,
    reporteVentasDiaHandler,
    exportacionReporteHandler,
    reporteVentasMensualHandler,
    reporteProductosMasVendidosHandler,
    categoriaVentaHandler,
    reporteMermasHandler,
    reporteLotesPorVencerHandler,
    reporteMovimientosHandler,
    reporteRentabilidadHandler,
    reporteAsistenciaHandler,
    impresionBoletaHandler,
  ];

/**
 * Despachador con control de acceso que aparece como
 * `C_DispatcherControlAcceso` en los diagramas de secuencia.
 */
export async function dispatchControllerWithAccessControl(
  channel: string,
  payload: unknown,
  controller: RegisteredController<any, any>,
  onSessionExpired: () => void,
) {
  const guard = await authorizeRequest(channel, payload, onSessionExpired);

  if (!guard.ok) {
    return guard.response;
  }

  return handleWithAudit(controller, guard.payload, guard.context, (event) =>
    registerAuditLog(db, appSchema, event),
  );
}

export function registerControllers(ipcMain: IpcMain): void {
  for (const controller of registeredControllers) {
    for (const channel of controller.metadata.channels) {
      ipcMain.handle(channel, async (_event, payload) => {
        const metadata = findControllerByChannel(channel);

        if (!metadata) {
          return {
            ok: false,
            error: {
              code: "INVALID_CHANNEL",
              message: `Canal IPC no registrado: ${channel}`,
            },
          };
        }

        // El dispatcher valida el JWT/rol y entrega al controlador la identidad
        // de confianza antes de procesar el canal.
        return dispatchControllerWithAccessControl(
          channel,
          payload,
          controller,
          () => {
            if (!_event.sender.isDestroyed())
              _event.sender.send(SESSION_EXPIRED_EVENT);
          },
        );
      });
    }
  }
}
