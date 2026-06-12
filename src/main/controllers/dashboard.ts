import { controllers } from '../../shared/controllers';
import type { DashboardData, DashboardRequest } from '../../shared/dashboard';
import type { Role } from '../../shared/navigation';
import { dataAccessError, type RegisteredController } from './base';
import {
  loadAttendanceSummary,
  loadDailySalesSummary,
  loadExpirationAlerts,
  loadStockAlerts,
} from './dashboard-queries';

const metadata = controllers[5];

export const dashboardController: RegisteredController = {
  metadata,
  handle: async (payload) => {
    if (!isDashboardRequest(payload)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          controllerId: metadata.id,
          message: 'Se requiere un rol valido para cargar el dashboard.',
        },
      };
    }

    try {
      const now = new Date();
      const [sales, stockAlerts, expirationAlerts, attendance] =
        await Promise.all([
          loadDailySalesSummary(now),
          loadStockAlerts(),
          loadExpirationAlerts(now),
          loadAttendanceSummary(now),
        ]);
      const data: DashboardData = {
        generatedAt: now.toISOString(),
        sales,
        stockAlerts,
        expirationAlerts,
        attendance,
      };

      return { ok: true, data };
    } catch {
      return dataAccessError(metadata);
    }
  },
};

function isDashboardRequest(payload: unknown): payload is DashboardRequest {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  return isRole((payload as { role?: unknown }).role);
}

function isRole(role: unknown): role is Role {
  return role === 'dueno' || role === 'trabajador';
}
