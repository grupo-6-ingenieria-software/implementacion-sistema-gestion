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
import { productDeleteController } from './product-delete';
import { productEditController } from './product-edit';
import { productQueryController } from './product-query';
import { productStatusController } from './product-status';
import { saleController } from './sale';
import { salesHistoryController } from './sales-history';
import {
  sessionController,
  refreshSessionActivity,
  NON_ACTIVITY_CHANNELS,
} from './session';
import { db, schema as appSchema } from '../../db/client';
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
  productDeleteController,
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

        // Actividad real del usuario (RF55): cada IPC autenticado de ACCIÓN
        // refresca sesion_fecha_hora_ultimo_acceso, de modo que la inactividad
        // sólo se acumula cuando el usuario no hace nada. Se excluyen el latido
        // (auth:verificar-sesion, de sólo lectura) y el logout (auth:logout):
        // ninguno representa actividad. session.ts es la única fuente de verdad
        // del cierre por inactividad; el latido sólo CONSULTA ese estado.
        const sesionId = guard.context.claims?.sesionId;
        if (sesionId && !NON_ACTIVITY_CHANNELS.has(channel)) {
          // Efecto secundario: un fallo de BD no debe bloquear la acción.
          await refreshSessionActivity(db, appSchema, sesionId).catch(
            () => undefined,
          );
        }

        return controller.handle(guard.payload, guard.context);
      });
    }
  }
}
