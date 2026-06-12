import { describe, expect, it } from 'vitest';
import type { ProductListItem } from '../../../shared/products';
import { getProductActionsForRole } from './ProductListView';

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
});
