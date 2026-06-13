import { describe, expect, it } from 'vitest';
import {
  getLotCreateEan13,
  getProductStatusEan13,
  getWasteCreateEan13,
  isImplementedViewNodeId,
} from './App';

describe('App inventory route helpers', () => {
  it('treats lot-create as an implemented view', () => {
    expect(isImplementedViewNodeId('lot-create')).toBe(true);
  });

  it('treats waste-create as an implemented view', () => {
    expect(isImplementedViewNodeId('waste-create')).toBe(true);
  });

  it('treats product-status as an implemented view', () => {
    expect(isImplementedViewNodeId('product-status')).toBe(true);
  });

  it('reads the product status EAN-13 route parameter', () => {
    expect(
      getProductStatusEan13(
        '/app/inventario/productos/7802920000015/estado',
      ),
    ).toBe('7802920000015');
  });

  it('reads the contextual EAN-13 query parameter', () => {
    expect(
      getLotCreateEan13('/app/inventario/lotes/nuevo?ean13=7802920000015'),
    ).toBe('7802920000015');
  });

  it('reads the contextual EAN-13 query parameter for waste registration', () => {
    expect(
      getWasteCreateEan13('/app/inventario/mermas/nueva?ean13=7802920000015'),
    ).toBe('7802920000015');
  });
});
