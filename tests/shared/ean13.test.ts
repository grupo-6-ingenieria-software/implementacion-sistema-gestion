import { describe, expect, it } from 'vitest';
import { isValidEan13, normalizeEan13 } from '../../src/shared/ean13';

describe('ean13 helpers', () => {
  it('normalizes scanner input to digits only', () => {
    expect(normalizeEan13(' 780-2920000017\n')).toBe('7802920000017');
  });

  it('validates a correct EAN-13 checksum', () => {
    expect(isValidEan13('7802920000015')).toBe(true);
  });

  it('rejects an invalid checksum or incomplete value', () => {
    expect(isValidEan13('7802920000017')).toBe(false);
    expect(isValidEan13('780292')).toBe(false);
  });
});
