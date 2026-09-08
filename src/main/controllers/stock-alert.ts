import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { loadStockAlerts, type DashboardDb } from './dashboard-queries';

const metadata = controllers[6];

export const stockAlertController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(await loadStockIndicator(db as unknown as DashboardDb));
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

// Operación C07 compartida entre IPC y C06.
export const loadStockIndicator = loadStockAlerts;
