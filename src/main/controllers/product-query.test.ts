import { describe, expect, it } from 'vitest';
import type { ControllerResponse } from '../../shared/controllers';
import type { Role } from '../../shared/navigation';
import type { ProductListItem, ProductListResponse } from '../../shared/products';
import { createProductQueryController } from './product-query';
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from './auth-context';

const products: ProductListItem[] = [
  {
    ean13: '7802345600012',
    nombre: 'Leche Soprole 1L',
    categoria: 'Lacteos',
    categoriaId: 2,
    precioCosto: 950,
    precioVenta: 1390,
    stockActual: 60,
    stockMinimo: 30,
    estado: 'activo',
    fechaRegistro: '2026-06-01',
  },
  {
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
  },
  {
    ean13: '7800000000123',
    nombre: 'Hallulla',
    categoria: 'Panaderia',
    categoriaId: 3,
    precioCosto: 150,
    precioVenta: 250,
    stockActual: 0,
    stockMinimo: 50,
    estado: 'inactivo',
    fechaRegistro: '2026-06-01',
  },
];

function createController() {
  return createProductQueryController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    listProducts: async ({ includeCost }) =>
      products.map((product) => {
        if (includeCost) {
          return product;
        }

        const { precioCosto, ...productWithoutCost } = product;
        void precioCosto;
        return productWithoutCost;
      }),
    listCategories: async () => [
      { id: 1, nombre: 'Bebidas' },
      { id: 2, nombre: 'Lacteos' },
      { id: 3, nombre: 'Panaderia' },
    ],
    findProduct: async (ean13) => {
      const product = products.find((item) => item.ean13 === ean13);

      if (!product) {
        return null;
      }

      return {
        ean13: product.ean13,
        nombre: product.nombre,
        categoriaId: product.categoriaId,
        precioCosto: 1000,
        precioVenta: product.precioVenta,
        stockMinimo: product.stockMinimo,
        estado: product.estado,
      };
    },
  });
}

async function invokeProductList(
  payload?: unknown,
): Promise<ControllerResponse<ProductListResponse>> {
  return createController().handle(payload, {
    channel: 'producto:listar',
  }) as Promise<ControllerResponse<ProductListResponse>>;
}

describe('product query controller', () => {
  it('lists active products by default with stock data', async () => {
    const response = await invokeProductList({ usuarioId: 'dueno' });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products).toHaveLength(2);
    expect(response.data.products[0]).toMatchObject({
      ean13: '7802920000017',
      nombre: 'Coca-Cola 1.5L',
      precioCosto: 1200,
      stockActual: 48,
    });
    expect(response.data.categories).toHaveLength(3);
  });

  it('filters products by name and EAN-13', async () => {
    const byName = await invokeProductList({ search: 'leche', usuarioId: 'dueno' });
    const byEan = await invokeProductList({
      search: '7802920000017',
      usuarioId: 'dueno',
    });

    expect(byName.ok).toBe(true);
    expect(byEan.ok).toBe(true);
    if (!byName.ok || !byEan.ok) {
      throw new Error('Expected successful product queries');
    }

    expect(byName.data.products.map((product) => product.nombre)).toEqual([
      'Leche Soprole 1L',
    ]);
    expect(byEan.data.products.map((product) => product.nombre)).toEqual([
      'Coca-Cola 1.5L',
    ]);
  });

  it('returns an empty list when filters do not match products', async () => {
    const response = await invokeProductList({
      search: 'producto inexistente',
      usuarioId: 'dueno',
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products).toEqual([]);
  });

  it('can include inactive products when requested', async () => {
    const response = await invokeProductList({
      estado: 'todos',
      sortBy: 'stockActual',
      usuarioId: 'dueno',
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products[0]).toMatchObject({
      nombre: 'Hallulla',
      estado: 'inactivo',
      stockActual: 0,
    });
  });

  it('omits cost data for worker product lists', async () => {
    const response = await invokeProductList({ usuarioId: 'trabajador' });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(response.data.products[0]).not.toHaveProperty('precioCosto');
  });

  it('rejects product lists without an authorized user', async () => {
    const response = await invokeProductList();

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden product list');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });
});

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role = usuarioId === 'dueno' ? 'dueno' : usuarioId === 'trabajador' ? 'trabajador' : null;

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? '',
    usuarioRol: role === 'dueno' ? 'dueño' : 'cajero',
    trabajadorNombre: role === 'dueno' ? 'Dueno Prueba' : 'Trabajador Prueba',
  };
}
