import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { getOpenCashRegister, type DbExecutor } from './sale-service';

type CashCheckResponse = {
  disponible: boolean;
  cierreCajaId: string;
};

export const cashCheckController: RegisteredController<unknown, CashCheckResponse> = {
  metadata: controllers[19],
  handle: async () => {
    const openCash = await getOpenCashRegister(db as unknown as DbExecutor);

    if (!openCash) {
      return controllerError(
        'BUSINESS_RULE',
        'La caja se encuentra cerrada. No es posible registrar ventas.',
        'cash-check',
      );
    }

    return controllerSuccess({
      disponible: true,
      cierreCajaId: openCash.cierreCajaId,
    });
  },
};
