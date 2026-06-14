import { describe, expect, it } from 'vitest';
import { isValidEan13, normalizeEan13 } from '../../src/shared/ean13';

describe('ean13 helpers', () => {
  it('normalizes scanner input to digits only', () => {
    expect(normalizeEan13(' 780-2920000015\n')).toBe('7802920000015');
  });

  it('accepts 13 digits with a correct mod-10 check digit', () => {
    // Codigos EAN-13 reales con digito verificador valido.
    expect(isValidEan13('7802920000015')).toBe(true);
    expect(isValidEan13('7802345600012')).toBe(true);
    expect(isValidEan13('4006381333931')).toBe(true);
  });

  it('rejects 13 digits with an incorrect check digit', () => {
    // Mismos 12 primeros digitos que un codigo valido, pero verificador erroneo.
    expect(isValidEan13('7802920000017')).toBe(false);
    expect(isValidEan13('7800000000123')).toBe(false);
    expect(isValidEan13('4006381333930')).toBe(false);
  });

  it('rejects incomplete, oversized, or non numeric values', () => {
    expect(isValidEan13('780292')).toBe(false);
    expect(isValidEan13('78029200000155')).toBe(false);
    expect(isValidEan13('780292000001a')).toBe(false);
  });
});
