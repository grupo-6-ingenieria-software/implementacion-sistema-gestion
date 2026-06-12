import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { loadStockAlerts, type DashboardDb } from './dashboard-service';

const metadata = controllers[6];

export const stockAlertController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(await loadStockAlerts(db as unknown as DashboardDb));
    } catch (error) {
      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible cargar la informacion solicitada.',
        metadata.id,
      );
    }
  },
};
