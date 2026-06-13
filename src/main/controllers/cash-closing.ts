import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import { notifyDashboardUpdated } from './dashboard-events';
import {
  CashClosingAccessError,
  CashClosingBusinessError,
  CashClosingValidationError,
  closeCashRegister,
  getCashClosingSummary,
} from './cash-closing-service';
import type { DbExecutor } from './sale-service';

export const cashClosingController: RegisteredController = {
  metadata: controllers[18],
  handle: async (payload, context) => {
    try {
      if (context.channel === 'caja:resumen-cierre') {
        return controllerSuccess(
          await getCashClosingSummary(db as unknown as DbExecutor, payload ?? {}),
        );
      }

      if (context.channel === 'caja:cerrar') {
        const result = await closeCashRegister(
          db as unknown as DbExecutor,
          payload ?? {},
        );
        notifyDashboardUpdated();
        return controllerSuccess(result);
      }

      return controllerError(
        'INVALID_CHANNEL',
        `Canal IPC no registrado: ${context.channel}`,
        'cash-closing',
      );
    } catch (error) {
      if (error instanceof CashClosingValidationError) {
        return controllerError('VALIDATION_ERROR', error.message, 'cash-closing');
      }

      if (error instanceof CashClosingAccessError) {
        return controllerError('FORBIDDEN', error.message, 'cash-closing');
      }

      if (error instanceof CashClosingBusinessError) {
        return controllerError('BUSINESS_RULE', error.message, 'cash-closing');
      }

      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible procesar el cierre de caja. Intente nuevamente.',
        'cash-closing',
      );
    }
  },
};
