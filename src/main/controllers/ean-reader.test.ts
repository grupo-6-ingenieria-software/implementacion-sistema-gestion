import { describe, expect, it } from 'vitest';
import { eanReaderController } from './ean-reader';

describe('ean reader controller', () => {
  it('accepts a valid EAN-13 capture', async () => {
    const response = await eanReaderController.handle(
      { value: '7802920000015' },
      { channel: 'ean:validar-captura' },
    );

    expect(response).toEqual({
      ok: true,
      data: { ean13: '7802920000015' },
    });
  });

  it('rejects an EAN-13 capture with invalid length', async () => {
    const response = await eanReaderController.handle(
      { value: '780292000001' },
      { channel: 'ean:validar-captura' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected EAN validation failure');
    }

    expect(response.error.code).toBe('VALIDATION_ERROR');
    expect(response.error.fieldErrors).toMatchObject({
      ean13:
        'El codigo EAN-13 debe tener exactamente 13 digitos numericos.',
    });
  });
});
