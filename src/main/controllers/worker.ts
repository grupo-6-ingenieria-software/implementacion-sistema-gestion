import { controllers } from '../../shared/controllers';
import {
  controllerError,
  controllerSuccess,
  notImplementedResponse,
  type RegisteredController,
} from './base';
import { db } from '../../db/client';
import {
  AttendanceAccessError,
  AttendanceValidationError,
  listActiveWorkers,
} from './attendance-service';
import type { DbExecutor } from './sale-service';

const metadata = controllers[20];

export const workerController: RegisteredController = {
  metadata,
  handle: async (payload, context) => {
    if (context.channel !== 'trabajador:listar-activos') {
      return notImplementedResponse(metadata, context.channel);
    }

    try {
      return controllerSuccess(
        await listActiveWorkers(db as unknown as Pick<DbExecutor, 'all'>, payload),
      );
    } catch (error) {
      if (error instanceof AttendanceValidationError) {
        return controllerError('VALIDATION_ERROR', error.message, metadata.id);
      }

      if (error instanceof AttendanceAccessError) {
        return controllerError('FORBIDDEN', error.message, metadata.id);
      }

      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible cargar los trabajadores activos.',
        metadata.id,
      );
    }
  },
};
