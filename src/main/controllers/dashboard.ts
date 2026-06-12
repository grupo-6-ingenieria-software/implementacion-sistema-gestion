import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { isDashboardRequest } from '../../shared/dashboard';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { loadDashboardData, type DashboardDb } from './dashboard-service';

const metadata = controllers[5];

export const dashboardController: RegisteredController = {
  metadata,
  handle: async (payload) => {
    if (!isDashboardRequest(payload)) {
      return controllerError(
        'VALIDATION_ERROR',
        'Se requiere una sesion valida para cargar el dashboard.',
        metadata.id,
      );
    }

    try {
      return controllerSuccess(
        await loadDashboardData(db as unknown as DashboardDb, payload),
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
