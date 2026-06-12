import type {
  ControllerMetadata,
  ControllerResponse,
} from '../../shared/controllers';

export type ControllerContext = {
  channel: string;
};

export type ControllerHandler<TPayload = unknown, TData = unknown> = (
  payload: TPayload,
  context: ControllerContext,
) => Promise<ControllerResponse<TData>>;

export type RegisteredController = {
  metadata: ControllerMetadata;
  handle: ControllerHandler;
};

export function createNotImplementedController(
  metadata: ControllerMetadata,
): RegisteredController {
  return {
    metadata,
    handle: async (_payload, context) => ({
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        controllerId: metadata.id,
        message: `${metadata.name} no implementa todavia el canal ${context.channel}.`,
      },
    }),
  };
}

export function notImplementedResponse(
  metadata: ControllerMetadata,
  channel: string,
): ControllerResponse {
  return {
    ok: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      controllerId: metadata.id,
      message: `${metadata.name} no implementa todavia el canal ${channel}.`,
    },
  };
}

export function dataAccessError(
  metadata: ControllerMetadata,
): ControllerResponse {
  return {
    ok: false,
    error: {
      code: 'DATA_ACCESS_ERROR',
      controllerId: metadata.id,
      message: 'No fue posible cargar la informacion solicitada.',
    },
  };
}
