import type {
  ControllerErrorCode,
  ControllerMetadata,
  ControllerResponse,
} from '../../shared/controllers';
import type { SessionTokenClaims } from './auth-jwt';

export type ControllerContext = {
  channel: string;
  /**
   * Claims verificados del JWT de sesión, inyectados por el dispatcher tras
   * verificar el token en el borde IPC. Presentes en canales autenticados; el
   * dispatcher también sobrescribe `payload.usuarioId` con la identidad de
   * confianza, de modo que los `authorizeUser` existentes operan sobre ella.
   */
  claims?: SessionTokenClaims;
};

export type ControllerHandler<TPayload = unknown, TData = unknown> = (
  payload: TPayload,
  context: ControllerContext,
) => Promise<ControllerResponse<TData>>;

export type RegisteredController<TPayload = unknown, TData = unknown> = {
  metadata: ControllerMetadata;
  handle: ControllerHandler<TPayload, TData>;
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
  return controllerError(
    'NOT_IMPLEMENTED',
    `${metadata.name} no implementa todavia el canal ${channel}.`,
    metadata.id,
  );
}

export function controllerSuccess<TData>(data: TData): ControllerResponse<TData> {
  return { ok: true, data };
}

export function controllerError(
  code: ControllerErrorCode,
  message: string,
  controllerId?: ControllerMetadata['id'],
): ControllerResponse<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      controllerId,
    },
  };
}
