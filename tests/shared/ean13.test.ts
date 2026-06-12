import { describe, expect, it } from 'vitest';
import { isValidEan13, normalizeEan13 } from '../../src/shared/ean13';

describe('ean13 helpers', () => {
  it('normalizes scanner input to digits only', () => {
    expect(normalizeEan13(' 780-2920000017\n')).toBe('7802920000017');
  });

  it('accepts exactly 13 numeric digits without checksum validation', () => {
    expect(isValidEan13('7802920000015')).toBe(true);
    expect(isValidEan13('7802920000017')).toBe(true);
  });

  it('rejects incomplete, oversized, or non numeric values', () => {
    expect(isValidEan13('780292')).toBe(false);
    expect(isValidEan13('78029200000175')).toBe(false);
    expect(isValidEan13('780292000001a')).toBe(false);
  });
});
