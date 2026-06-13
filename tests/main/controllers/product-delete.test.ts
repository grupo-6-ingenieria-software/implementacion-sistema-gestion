import { describe, expect, it } from 'vitest';
import { AccessDeniedError } from '../../../src/main/controllers/auth-context';
import {
  ProductDeleteError,
  createProductDeleteController,
} from '../../../src/main/controllers/product-delete';

const validPayload = {
  ean13: '7802920000015',
  confirmacion: true,
  usuarioId: 'dueno',
};

describe('product delete controller', () => {
  it('rejects channels not declared for the controller', async () => {
    const controller = createProductDeleteController({
      deleteProduct: async () => ({ ean13: validPayload.ean13 }),
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

  it('validates EAN-13, confirmation and authenticated user', async () => {
    const controller = createProductDeleteController({
      deleteProduct: async () => ({ ean13: validPayload.ean13 }),
    });

    const response = await controller.handle(
      { ean13: '123', confirmacion: false, usuarioId: '' },
      { channel: 'producto:eliminar' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected validation response');
    }

    expect(response.error.code).toBe('VALIDATION_ERROR');
    expect(response.error.fieldErrors).toMatchObject({
      ean13: 'El codigo EAN-13 debe tener exactamente 13 digitos numericos.',
      confirmacion: 'Debe confirmar la eliminacion del producto.',
      usuarioId: 'No hay un usuario responsable para eliminar el producto.',
    });
  });

  it('maps authorization failures to forbidden responses', async () => {
    const controller = createProductDeleteController({
      deleteProduct: async () => {
        throw new AccessDeniedError();
      },
    });

    const response = await controller.handle(validPayload, {
      channel: 'producto:eliminar',
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden response');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });

  it('maps missing products to not found responses', async () => {
    const controller = createProductDeleteController({
      deleteProduct: async () => {
        throw new ProductDeleteError(
          'not-found',
          'No se encontro el producto solicitado.',
        );
      },
    });

    const response = await controller.handle(validPayload, {
      channel: 'producto:eliminar',
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected not found response');
    }

    expect(response.error.code).toBe('NOT_FOUND');
  });

  it('blocks products with associated records', async () => {
    const controller = createProductDeleteController({
      deleteProduct: async () => {
        throw new ProductDeleteError(
          'has-relations',
          'El producto no puede eliminarse porque tiene registros asociados (lotes). Debe desactivarlo para impedir su uso en nuevas operaciones.',
        );
      },
    });

    const response = await controller.handle(validPayload, {
      channel: 'producto:eliminar',
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected business rule response');
    }

    expect(response.error.code).toBe('BUSINESS_RULE');
    expect(response.error.message).toContain('Debe desactivarlo');
  });

  it('deletes products without associated records', async () => {
    const controller = createProductDeleteController({
      deleteProduct: async (payload) => ({
        ean13: payload.ean13!,
      }),
    });

    const response = await controller.handle(validPayload, {
      channel: 'producto:eliminar',
    });

    expect(response).toEqual({
      ok: true,
      data: { ean13: validPayload.ean13 },
    });
  });
});
