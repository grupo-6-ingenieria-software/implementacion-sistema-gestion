import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { loadDailySalesSummary, type DashboardDb } from './dashboard-service';

const metadata = controllers[8];

export const dailySalesTotalController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(
        await loadDailySalesSummary(db as unknown as DashboardDb),
      );
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
