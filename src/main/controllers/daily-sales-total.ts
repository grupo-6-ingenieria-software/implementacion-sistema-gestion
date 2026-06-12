import { controllers } from '../../shared/controllers';
import { dataAccessError, type RegisteredController } from './base';
import { loadDailySalesSummary } from './dashboard-queries';

const metadata = controllers[8];

export const dailySalesTotalController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return { ok: true, data: await loadDailySalesSummary() };
    } catch {
      return dataAccessError(metadata);
    }
  },
};
