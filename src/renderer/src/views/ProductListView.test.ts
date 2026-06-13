import { describe, expect, it } from 'vitest';
import type { ProductListItem } from '../../../shared/products';
import { getProductActionsForRole, orderProductsForList } from './ProductListView';

const product: ProductListItem = {
  ean13: '7802920000017',
  nombre: 'Coca-Cola 1.5L',
  categoria: 'Bebidas',
  categoriaId: 1,
  precioCosto: 1200,
  precioVenta: 1800,
  stockActual: 48,
  stockMinimo: 20,
  estado: 'activo',
  fechaRegistro: '2026-06-01',
};

const inactiveProduct: ProductListItem = {
  ...product,
  ean13: '7800000000123',
  nombre: 'Hallulla',
  estado: 'inactivo',
};

describe('ProductListView actions', () => {
  it('shows administrative product actions to the owner', () => {
    expect(
      getProductActionsForRole('dueno', product).map((action) => action.label),
    ).toEqual([
      'Editar',
      'Cambiar estado',
      'Registrar lote',
      'Registrar merma',
    ]);
  });

  it('shows only operational product actions to a worker', () => {
    expect(
      getProductActionsForRole('trabajador', product).map(
        (action) => action.label,
      ),
    ).toEqual(['Cambiar estado', 'Registrar merma']);
  });

  it('hides active-product operations for inactive products', () => {
    expect(
      getProductActionsForRole('dueno', inactiveProduct).map(
        (action) => action.label,
      ),
    ).toEqual(['Editar', 'Cambiar estado']);
    expect(
      getProductActionsForRole('trabajador', inactiveProduct).map(
        (action) => action.label,
      ),
    ).toEqual(['Cambiar estado']);
  });

  it('keeps inactive products at the end of the list', () => {
    expect(orderProductsForList([inactiveProduct, product])).toEqual([
      product,
      inactiveProduct,
    ]);
  });
});
