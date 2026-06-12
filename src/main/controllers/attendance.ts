import { controllers } from '../../shared/controllers';
import {
  dataAccessError,
  notImplementedResponse,
  type RegisteredController,
} from './base';
import { loadAttendanceSummary } from './dashboard-queries';

const metadata = controllers[22];

export const attendanceController: RegisteredController = {
  metadata,
  handle: async (_payload, context) => {
    if (context.channel !== 'asistencia:resumen-dashboard') {
      return notImplementedResponse(metadata, context.channel);
    }

    try {
      return { ok: true, data: await loadAttendanceSummary() };
    } catch {
      return dataAccessError(metadata);
    }
  },
};
