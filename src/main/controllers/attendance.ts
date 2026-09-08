import { controllers } from '../../shared/controllers';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import { db } from '../../db/client';
import { isDashboardRequest } from '../../shared/dashboard';
import { type DashboardDb } from './dashboard-queries';
import { loadAttendanceIndicator } from './attendance-summary';
import { notifyDashboardUpdated } from './dashboard-events';
import type { DbExecutor } from './sale-service';
import {
  AttendanceAccessError,
  AttendanceBusinessError,
  AttendanceValidationError,
  registerAttendanceEntry,
  registerAttendanceEntryWithoutShift,
  registerAttendanceExit,
} from './attendance-service';

const metadata = controllers[22];

export const attendanceController: RegisteredController = {
  metadata,
  handle: async (payload, context) => {
    try {
      if (context.channel === 'asistencia:resumen-dashboard') {
        const request = context.claims && { role: context.claims.rol, usuarioId: context.claims.usuarioId };
        if (!isDashboardRequest(request)) {
          return controllerError(
            'VALIDATION_ERROR',
            'Se requiere una sesion valida para cargar el resumen de asistencia.',
            metadata.id,
          );
        }

        return controllerSuccess(
          await loadAttendanceIndicator(db as unknown as DashboardDb, request),
        );
      }

      if (context.channel === 'asistencia:entrada') {
        const result = await registerAttendanceEntry(
          db as unknown as DbExecutor,
          payload ?? {},
        );

        if (result.status === 'registered') {
          notifyDashboardUpdated();
        }

        return controllerSuccess(result);
      }

      if (context.channel === 'asistencia:entrada-sin-turno') {
        const result = await registerAttendanceEntryWithoutShift(
          db as unknown as DbExecutor,
          payload ?? {},
        );
        if (result.status === 'registered') {
          notifyDashboardUpdated();
        }
        return controllerSuccess(result);
      }

      if (context.channel === 'asistencia:salida') {
        const result = await registerAttendanceExit(
          db as unknown as DbExecutor,
          payload ?? {},
        );
        if (result.status === 'registered') {
          notifyDashboardUpdated();
        }
        return controllerSuccess(result);
      }

      return controllerError(
        'INVALID_CHANNEL',
        `Canal IPC no registrado: ${context.channel}`,
        metadata.id,
      );
    } catch (error) {
      if (error instanceof AttendanceValidationError) {
        return controllerError('VALIDATION_ERROR', error.message, metadata.id);
      }

      if (error instanceof AttendanceAccessError) {
        return controllerError('FORBIDDEN', error.message, metadata.id);
      }

      if (error instanceof AttendanceBusinessError) {
        return controllerError('BUSINESS_RULE', error.message, metadata.id);
      }

      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible procesar la asistencia. Intente nuevamente.',
        metadata.id,
      );
    }
  },
};
