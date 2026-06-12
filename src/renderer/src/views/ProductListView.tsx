import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Role } from '../../../shared/navigation';
import {
  defaultProductListFilters,
  type ProductCategoryOption,
  type ProductListItem,
  type ProductListResponse,
  type ProductSortBy,
  type ProductSortDirection,
} from '../../../shared/products';
import { CampoEAN13Input } from '../components';

type ProductListViewProps = {
  role: Role;
  usuarioId: string;
  onNavigate: (path: string) => void;
};

export type ProductAction = {
  label: string;
  path: string;
};

const currencyFormatter = new Intl.NumberFormat('es-CL', {
  currency: 'CLP',
  maximumFractionDigits: 0,
  style: 'currency',
});

export function ProductListView({
  role,
  usuarioId,
  onNavigate,
}: ProductListViewProps): ReactElement {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<ProductCategoryOption[]>([]);
  const [textSearch, setTextSearch] = useState('');
  const [eanSearch, setEanSearch] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [sortBy, setSortBy] = useState<ProductSortBy>(
    defaultProductListFilters.sortBy,
  );
  const [sortDirection, setSortDirection] = useState<ProductSortDirection>(
    defaultProductListFilters.sortDirection,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const payload = useMemo(
    () => ({
      usuarioId,
      search: eanSearch.trim() || textSearch.trim(),
      categoriaId: categoriaId ? Number(categoriaId) : undefined,
      sortBy,
      sortDirection,
    }),
    [categoriaId, eanSearch, sortBy, sortDirection, textSearch, usuarioId],
  );

  useEffect(() => {
    let isCurrent = true;

    async function loadProducts(): Promise<void> {
      setLoading(true);
      setError(null);

      const response = await window.appApi.invoke<ProductListResponse>(
        'producto:listar',
        payload,
      );

      if (!isCurrent) {
        return;
      }

      if (response.ok) {
        setProducts(response.data.products);
        setCategories(response.data.categories);
      } else {
        setProducts([]);
        setError(
          response.error.message ||
            'No fue posible cargar los productos. Intente nuevamente.',
        );
      }

      setLoading(false);
    }

    loadProducts().catch(() => {
      if (!isCurrent) {
        return;
      }

      setProducts([]);
      setError('No fue posible cargar los productos. Intente nuevamente.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [payload, reloadKey]);

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Inventario</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            Productos
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-[#61717f]">
            Consulta productos activos, revisa stock disponible y accede a las
            acciones operativas permitidas para tu rol.
          </p>
        </div>
        {role === 'dueno' ? (
          <button
            className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
            type="button"
            onClick={() => onNavigate('/app/inventario/productos/nuevo')}
          >
            Nuevo producto
          </button>
        ) : null}
      </div>

      <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px_180px]">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Buscar por nombre
            <input
              className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              placeholder="Ej: leche, pan, bebida"
              value={textSearch}
              onChange={(event) => setTextSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Buscar por EAN-13
            <CampoEAN13Input value={eanSearch} onChange={setEanSearch} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Categoria
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={categoriaId}
              onChange={(event) => setCategoriaId(event.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e3e8ee] pt-4">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[#24313d]">
              Ordenar por
              <select
                className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as ProductSortBy)}
              >
                <option value="nombre">Nombre</option>
                <option value="categoria">Categoria</option>
                <option value="stockActual">Stock</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-[#24313d]">
              Direccion
              <select
                className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={sortDirection}
                onChange={(event) =>
                  setSortDirection(event.target.value as ProductSortDirection)
                }
              >
                <option value="asc">Ascendente</option>
                <option value="desc">Descendente</option>
              </select>
            </label>
          </div>
          <button
            className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            Actualizar
          </button>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-4">
          <p className="text-sm font-semibold text-[#24313d]">
            {loading ? 'Cargando productos...' : `${products.length} productos`}
          </p>
          <p className="text-xs font-semibold uppercase text-[#61717f]">
            Stock critico cuando stock actual es menor o igual al minimo
          </p>
        </div>

        {error ? (
          <ProductMessage
            actionLabel="Intentar nuevamente"
            message={error}
            onAction={() => setReloadKey((current) => current + 1)}
          />
        ) : null}

        {!error && loading ? (
          <ProductMessage message="Cargando informacion de productos..." />
        ) : null}

        {!error && !loading && products.length === 0 ? (
          <ProductMessage message="No se encontraron productos" />
        ) : null}

        {!error && !loading && products.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-[#f6f7f9] text-xs uppercase text-[#61717f]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Producto</th>
                  <th className="px-5 py-3 font-semibold">EAN-13</th>
                  <th className="px-5 py-3 font-semibold">Categoria</th>
                  {role === 'dueno' ? (
                    <th className="px-5 py-3 font-semibold">Precio costo</th>
                  ) : null}
                  <th className="px-5 py-3 font-semibold">Precio venta</th>
                  <th className="px-5 py-3 font-semibold">Stock</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <ProductRow
                    key={product.ean13}
                    product={product}
                    role={role}
                    onNavigate={onNavigate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function ProductRow({
  product,
  role,
  onNavigate,
}: {
  product: ProductListItem;
  role: Role;
  onNavigate: (path: string) => void;
}): ReactElement {
  const isLowStock = product.stockActual <= product.stockMinimo;

  return (
    <tr className="border-t border-[#edf1f5] align-top">
      <td className="px-5 py-4">
        <p className="font-semibold text-[#17202a]">{product.nombre}</p>
        <p className="mt-1 text-xs text-[#61717f]">
          Registrado {formatDate(product.fechaRegistro)}
        </p>
      </td>
      <td className="px-5 py-4 font-mono text-xs text-[#24313d]">
        {product.ean13}
      </td>
      <td className="px-5 py-4 text-[#24313d]">{product.categoria}</td>
      {role === 'dueno' ? (
        <td className="px-5 py-4 font-semibold text-[#24313d]">
          {currencyFormatter.format(product.precioCosto ?? 0)}
        </td>
      ) : null}
      <td className="px-5 py-4 font-semibold text-[#24313d]">
        {currencyFormatter.format(product.precioVenta)}
      </td>
      <td className="px-5 py-4">
        <p className="font-semibold text-[#24313d]">{product.stockActual}</p>
        <p className="mt-1 text-xs text-[#61717f]">
          Minimo {product.stockMinimo}
        </p>
        {isLowStock ? (
          <span className="mt-2 inline-flex rounded-md bg-[#fff3d6] px-2 py-1 text-xs font-semibold text-[#8a5a12]">
            Stock critico
          </span>
        ) : null}
      </td>
      <td className="px-5 py-4">
        <span
          className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
            product.estado === 'activo'
              ? 'bg-[#e3f4ea] text-[#2d6a4f]'
              : 'bg-[#edf1f5] text-[#61717f]'
          }`}
        >
          {product.estado}
        </span>
      </td>
      <td className="px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {getProductActionsForRole(role, product).map((action) => (
            <button
              className="rounded-md border border-[#9ba9b5] px-2.5 py-1.5 text-xs font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              key={action.label}
              type="button"
              onClick={() => onNavigate(action.path)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}

function ProductMessage({
  actionLabel,
  message,
  onAction,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
}): ReactElement {
  return (
    <div className="grid justify-items-center gap-3 px-5 py-12 text-center">
      <p className="text-sm font-semibold text-[#61717f]">{message}</p>
      {actionLabel && onAction ? (
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function getProductActionsForRole(
  role: Role,
  product: ProductListItem,
): ProductAction[] {
  const ean13 = encodeURIComponent(product.ean13);

  if (role === 'dueno') {
    return [
      {
        label: 'Editar',
        path: `/app/inventario/productos/${ean13}/editar`,
      },
      {
        label: 'Cambiar estado',
        path: `/app/inventario/productos/${ean13}/estado`,
      },
      {
        label: 'Registrar lote',
        path: `/app/inventario/lotes/nuevo?ean13=${ean13}`,
      },
      {
        label: 'Registrar merma',
        path: `/app/inventario/mermas/nueva?ean13=${ean13}`,
      },
    ];
  }

  return [
    {
      label: 'Cambiar estado',
      path: `/app/inventario/productos/${ean13}/estado`,
    },
    {
      label: 'Registrar merma',
      path: `/app/inventario/mermas/nueva?ean13=${ean13}`,
    },
  ];
}

function formatDate(value: string): string {
  if (!value) {
    return 'sin fecha';
  }

  return value.slice(0, 10);
}
