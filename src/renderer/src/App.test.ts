import { describe, expect, it } from 'vitest';
import { getLotCreateEan13, isImplementedViewNodeId } from './App';

describe('App lot route helpers', () => {
  it('treats lot-create as an implemented view', () => {
    expect(isImplementedViewNodeId('lot-create')).toBe(true);
  });

  it('reads the contextual EAN-13 query parameter', () => {
    expect(
      getLotCreateEan13('/app/inventario/lotes/nuevo?ean13=7802920000015'),
    ).toBe('7802920000015');
  });
});
