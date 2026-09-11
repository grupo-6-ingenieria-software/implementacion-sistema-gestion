import type { IpcMain } from "electron";
import { findControllerByChannel } from "../../shared/controllers";
import { authorizeRequest } from "./auth-guard";
import { SESSION_EXPIRED_EVENT } from "../../shared/auth";
import { accessControlController } from "./access-control";
import { attendanceController } from "./attendance";
import { auditController } from "./audit";
import { authLoginController } from "./auth-login";
import { cashCheckController } from "./cash-check";
import { cashClosingController } from "./cash-closing";
import { configPrevisionalController } from "./configuracion-previsional";
import { dailySalesTotalController } from "./daily-sales-total";
import { dashboardController } from "./dashboard";
import { eanReaderController } from "./ean-reader";
import { expirationAlertController } from "./expiration-alert";
import { lotController } from "./lot";
import { passwordController } from "./password";
import { productCreateController } from "./product-create";
import { productDeleteController } from "./product-delete";
import { productEditController } from "./product-edit";
import { productQueryController } from "./product-query";
import { productStatusController } from "./product-status";
import { remuneracionController } from "./remuneracion";
import { saleController } from "./sale";
import { salesHistoryController } from "./sales-history";
import { sessionController } from "./session";
import { shiftController } from "./shift";
import { stockAlertController } from "./stock-alert";
import { stockDiscountController } from "./stock-discount";
import { supplierOrderController } from "./supplier-order";
import { supplierOrderReceptionController } from "./supplier-order-reception";
import { userManagementController } from "./user-management";
import { wasteController } from "./waste";
import { workerController } from "./worker";
import type { RegisteredController } from "./base";

export const registeredControllers: readonly RegisteredController<any, any>[] =
  [
    authLoginController,
    passwordController,
    accessControlController,
    auditController,
    sessionController,
    dashboardController,
    stockAlertController,
    expirationAlertController,
    dailySalesTotalController,
    productCreateController,
    productEditController,
    productStatusController,
    productQueryController,
    lotController,
    wasteController,
    saleController,
    stockDiscountController,
    salesHistoryController,
    cashClosingController,
    cashCheckController,
    workerController,
    shiftController,
    attendanceController,
    eanReaderController,
    userManagementController,
    productDeleteController,
    remuneracionController,
    configPrevisionalController,
    supplierOrderController,
    supplierOrderReceptionController,
  ];

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

        // Guard de identidad/rol en el borde IPC: verifica el JWT de sesión
        // (RF56/CU56) antes de despachar, salvo en canales públicos. En éxito,
        // sobrescribe usuarioId con la identidad de confianza y adjunta claims.
        const guard = await authorizeRequest(channel, payload, () => {
          if (!_event.sender.isDestroyed())
            _event.sender.send(SESSION_EXPIRED_EVENT);
        });

        if (!guard.ok) {
          return guard.response;
        }

        return controller.handle(guard.payload, guard.context);
      });
    }
  }
}
