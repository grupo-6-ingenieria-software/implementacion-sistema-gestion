import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import {
  registerSale,
  SaleBusinessError,
  SaleValidationError,
  type DbExecutor,
  type SaleRegisterPayload,
} from './sale-service';
import { notifyDashboardUpdated } from './dashboard-events';
import {
  inspectDailyCashRegister,
  type CashCheckDb,
} from './cash-check';
import {
  searchActiveProducts,
  type ActiveProductQuery,
} from './product-query';
import { AccessDeniedError } from './auth-context';

export const saleController: RegisteredController<unknown, unknown> = {
  metadata: controllers[15],
  handle: async (payload, context) => {
    try {
      if (context.channel === 'venta:verificar-caja') {
        const state = await inspectDailyCashRegister(
          db as unknown as CashCheckDb,
        );
        if (state.status !== 'abierta') {
          return controllerError(
            'BUSINESS_RULE',
            'La caja de este día ya fue cerrada. No es posible registrar nuevas ventas.',
            'sale',
          );
        }
        return controllerSuccess({
          disponible: true,
          cierreCajaId: state.status === 'abierta' ? state.cierreCajaId : undefined,
        });
      }

      if (context.channel === 'venta:producto') {
        const input = (payload ?? {}) as ActiveProductQuery;
        const products = await searchActiveProducts(input);
        const search = input.ean13?.trim() || input.query?.trim();
        if (search && products.length === 0) {
          return controllerError(
            'BUSINESS_RULE',
            'No se encontraron productos activos para la búsqueda.',
            'sale',
          );
        }
        return controllerSuccess(products);
      }

      const receipt = await registerSale(
        db as unknown as DbExecutor,
        payload as SaleRegisterPayload,
      );
      notifyDashboardUpdated();
      return controllerSuccess(receipt);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return controllerError('VALIDATION_ERROR', error.message, 'sale');
      }

      if (error instanceof SaleBusinessError) {
        return controllerError('BUSINESS_RULE', error.message, 'sale');
      }

      if (error instanceof AccessDeniedError) {
        return controllerError('FORBIDDEN', error.message, 'sale');
      }

      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible registrar la venta. Intente nuevamente.',
        'sale',
      );
    }
  },
};
