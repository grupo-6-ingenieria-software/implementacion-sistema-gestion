import { describe, expect, it } from 'vitest';
import { AccessDeniedError } from './auth-context';
import { createProductStatusController, ProductStatusError } from './product-status';

describe('product status controller', () => {
  it('rejects channels not declared for the controller', async () => {
    const controller = createProductStatusController({
      changeStatus: async () => ({
        ean13: '7802920000015',
        estado: 'inactivo',
      }),
    });

    const response = await controller.handle(
      {},
      { channel: 'producto:estado' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected invalid channel');
    }

    expect(response.error.code).toBe('INVALID_CHANNEL');
  });

  it('validates the requested status payload', async () => {
    const controller = createProductStatusController({
      changeStatus: async () => ({
        ean13: '7802920000015',
        estado: 'inactivo',
      }),
    });

    const response = await controller.handle(
      { ean13: '123', estado: 'retirado', usuarioId: '' },
      { channel: 'producto:cambiar-estado' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected validation response');
    }

    expect(response.error.code).toBe('VALIDATION_ERROR');
    expect(response.error.fieldErrors).toMatchObject({
      ean13: 'El codigo EAN-13 debe tener exactamente 13 digitos numericos.',
      estado: 'Seleccione un estado valido.',
      usuarioId: 'No hay un usuario responsable para cambiar el estado.',
    });
  });

  it('maps authorization failures to forbidden responses', async () => {
    const controller = createProductStatusController({
      changeStatus: async () => {
        throw new AccessDeniedError();
      },
    });

    const response = await controller.handle(
      {
        ean13: '7802920000015',
        estado: 'inactivo',
        usuarioId: 'trabajador',
      },
      { channel: 'producto:cambiar-estado' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden response');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });

  it('changes the product status', async () => {
    const controller = createProductStatusController({
      changeStatus: async (payload) => ({
        ean13: payload.ean13!,
        estado: payload.estado!,
      }),
    });

    const response = await controller.handle(
      {
        ean13: '7802920000015',
        estado: 'inactivo',
        usuarioId: 'dueno',
      },
      { channel: 'producto:cambiar-estado' },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data).toEqual({
      ean13: '7802920000015',
      estado: 'inactivo',
    });
  });

  it('maps missing products to not found responses', async () => {
    const controller = createProductStatusController({
      changeStatus: async () => {
        throw new ProductStatusError(
          'not-found',
          'No se encontro el producto solicitado.',
        );
      },
    });

    const response = await controller.handle(
      {
        ean13: '7802920000015',
        estado: 'inactivo',
        usuarioId: 'dueno',
      },
      { channel: 'producto:cambiar-estado' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected not found response');
    }

    expect(response.error.code).toBe('NOT_FOUND');
  });
});
