import { controllers } from '../../shared/controllers';
import { isValidEan13, normalizeEan13 } from '../../shared/ean13';
import { controllerError, controllerSuccess, type RegisteredController } from './base';

type EanReaderPayload = {
  value?: string;
};

type EanReaderResponse = {
  ean13: string;
};

export const eanReaderController: RegisteredController<
  EanReaderPayload,
  EanReaderResponse
> = {
  metadata: controllers[23],
  handle: async (payload) => {
    const ean13 = normalizeEan13(payload?.value ?? '');

    if (!isValidEan13(ean13)) {
      return controllerError(
        'VALIDATION_ERROR',
        'Ingrese un código EAN-13 válido.',
        'ean-reader',
      );
    }

    return controllerSuccess({ ean13 });
  },
};
