import { controllers } from '../../shared/controllers';
import { dataAccessError, type RegisteredController } from './base';
import { loadExpirationAlerts } from './dashboard-queries';

const metadata = controllers[7];

export const expirationAlertController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return { ok: true, data: await loadExpirationAlerts() };
    } catch {
      return dataAccessError(metadata);
    }
  },
};
