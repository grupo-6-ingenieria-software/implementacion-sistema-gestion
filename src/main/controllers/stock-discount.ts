import { controllers } from '../../shared/controllers';
import { controllerError, type RegisteredController } from './base';
export { consumeStockForSale } from './sale-service';

export const stockDiscountController: RegisteredController = {
  metadata: controllers[16],
  handle: async () =>
    controllerError(
      'BUSINESS_RULE',
      'El descuento de stock se ejecuta automáticamente al registrar una venta.',
      'stock-discount',
    ),
};
