import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import {
  registerSale,
  SaleBusinessError,
  SaleValidationError,
  type DbExecutor,
  type SaleReceipt,
  type SaleRegisterPayload,
} from './sale-service';
import { notifyDashboardUpdated } from './dashboard-events';

export const saleController: RegisteredController<
  SaleRegisterPayload,
  SaleReceipt
> = {
  metadata: controllers[15],
  handle: async (payload) => {
    try {
      const receipt = await registerSale(db as unknown as DbExecutor, payload);
      notifyDashboardUpdated();
      return controllerSuccess(receipt);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return controllerError('VALIDATION_ERROR', error.message, 'sale');
      }

      if (error instanceof SaleBusinessError) {
        return controllerError('BUSINESS_RULE', error.message, 'sale');
      }

      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible registrar la venta. Intente nuevamente.',
        'sale',
      );
    }
  },
};
