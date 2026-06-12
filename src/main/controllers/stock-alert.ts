import { controllers } from '../../shared/controllers';
import { dataAccessError, type RegisteredController } from './base';
import { loadStockAlerts } from './dashboard-queries';

const metadata = controllers[6];

export const stockAlertController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return { ok: true, data: await loadStockAlerts() };
    } catch {
      return dataAccessError(metadata);
    }
  },
};
