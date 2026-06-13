import type { IpcMain } from 'electron';
import { findControllerByChannel } from '../../shared/controllers';
import { guardChannel } from './auth-guard';
import { accessControlController } from './access-control';
import { attendanceController } from './attendance';
import { auditController } from './audit';
import { authLoginController } from './auth-login';
import { cashCheckController } from './cash-check';
import { cashClosingController } from './cash-closing';
import { dailySalesTotalController } from './daily-sales-total';
import { dashboardController } from './dashboard';
import { eanReaderController } from './ean-reader';
import { expirationAlertController } from './expiration-alert';
import { lotController } from './lot';
import { passwordController } from './password';
import { productCreateController } from './product-create';
import { productEditController } from './product-edit';
import { productQueryController } from './product-query';
import { productStatusController } from './product-status';
import { saleController } from './sale';
import { salesHistoryController } from './sales-history';
import { sessionController } from './session';
import { shiftController } from './shift';
import { stockAlertController } from './stock-alert';
import { stockDiscountController } from './stock-discount';
import { userManagementController } from './user-management';
import { wasteController } from './waste';
import { workerController } from './worker';
import type { RegisteredController } from './base';

export const registeredControllers: readonly RegisteredController<any, any>[] = [
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
              code: 'INVALID_CHANNEL',
              message: `Canal IPC no registrado: ${channel}`,
            },
          };
        }

        // Guard de identidad/rol en el borde IPC: verifica el JWT de sesión
        // (RF56/CU57) antes de despachar, salvo en canales públicos. En éxito,
        // sobrescribe usuarioId con la identidad de confianza y adjunta claims.
        const guard = await guardChannel(channel, payload);

        if (!guard.ok) {
          return guard.response;
        }

        // session.ts es la única fuente de verdad de inactividad: refresca
        // ultimo_acceso en cada verificar-sesión válida y cierra la fila tras
        // 30 min. El dispatcher ya no lleva un contador de actividad propio.
        return controller.handle(guard.payload, guard.context);
      });
    }
  }
}
