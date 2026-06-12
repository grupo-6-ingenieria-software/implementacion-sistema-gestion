import { controllers } from '../../shared/controllers';
import {
  controllerError,
  controllerSuccess,
  notImplementedResponse,
  type RegisteredController,
} from './base';
import { db } from '../../db/client';
import { loadAttendanceSummary, type DashboardDb } from './dashboard-service';

const metadata = controllers[22];

export const attendanceController: RegisteredController = {
  metadata,
  handle: async (_payload, context) => {
    if (context.channel !== 'asistencia:resumen-dashboard') {
      return notImplementedResponse(metadata, context.channel);
    }

    try {
      return controllerSuccess(
        await loadAttendanceSummary(db as unknown as DashboardDb),
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
