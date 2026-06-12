import { controllers } from '../../shared/controllers';
import { invalidEan13Message, isValidEan13 } from '../../shared/products';
import type { ControllerHandler, RegisteredController } from './base';

type EanValidationResponse = {
  ean13: string;
};

const handle: ControllerHandler<unknown, EanValidationResponse> = async (
  payload,
  context,
) => {
  if (context.channel !== 'ean:validar-captura') {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANNEL',
        controllerId: 'ean-reader',
        message: `Canal IPC no registrado: ${context.channel}`,
      },
    };
  }

  const rawValue =
    typeof payload === 'object' &&
    payload !== null &&
    'value' in payload &&
    typeof payload.value === 'string'
      ? payload.value
      : '';
  const ean13 = rawValue.replace(/\D/g, '').slice(0, 13);

  if (!isValidEan13(ean13)) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'ean-reader',
        fieldErrors: { ean13: invalidEan13Message },
        message: 'Codigo invalido, intente escanear nuevamente.',
      },
    };
  }

  return {
    ok: true,
    data: { ean13 },
  };
};

export const eanReaderController: RegisteredController = {
  metadata: controllers[23],
  handle,
};
