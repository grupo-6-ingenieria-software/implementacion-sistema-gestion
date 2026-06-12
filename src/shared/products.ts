export type ProductStatus = 'activo' | 'inactivo';
export type ProductStatusFilter = ProductStatus | 'todos';
export type ProductSortBy = 'nombre' | 'categoria' | 'stockActual';
export type ProductSortDirection = 'asc' | 'desc';
export type ProductFieldErrors = Partial<
  Record<
    | 'ean13'
    | 'nombre'
    | 'categoriaId'
    | 'precioCosto'
    | 'precioVenta'
    | 'stockMinimo'
    | 'usuarioId',
    string
  >
>;

export type ProductListFilters = {
  search: string;
  estado: ProductStatusFilter;
  categoriaId?: number;
  sortBy: ProductSortBy;
  sortDirection: ProductSortDirection;
};

export type ProductListPayload = Partial<ProductListFilters> & {
  usuarioId?: string;
};

export type ProductCategoryOption = {
  id: number;
  nombre: string;
};

export type ProductListItem = {
  ean13: string;
  nombre: string;
  categoria: string;
  categoriaId: number;
  precioCosto?: number;
  precioVenta: number;
  stockActual: number;
  stockMinimo: number;
  estado: ProductStatus;
  fechaRegistro: string;
};

export type ProductListResponse = {
  products: ProductListItem[];
  categories: ProductCategoryOption[];
};

export type ProductFormValues = {
  ean13: string;
  nombre: string;
  categoriaId: number;
  precioCosto: number;
  precioVenta: number;
  stockMinimo: number;
};

export type ProductCreatePayload = ProductFormValues & {
  usuarioId?: string;
};

export type ProductEditPayload = ProductFormValues & {
  originalEan13: string;
  usuarioId?: string;
};

export type ProductMutationResponse = {
  ean13: string;
};

export type ProductDetailPayload = {
  ean13?: string;
};

export type ProductDetailResponse = {
  product: ProductFormValues & {
    estado: ProductStatus;
  };
  categories: ProductCategoryOption[];
};

export const invalidEan13Message =
  'El codigo EAN-13 debe tener exactamente 13 digitos numericos.';

const productStatusFilters = new Set<ProductStatusFilter>([
  'activo',
  'inactivo',
  'todos',
]);
const productSortFields = new Set<ProductSortBy>([
  'nombre',
  'categoria',
  'stockActual',
]);
const productSortDirections = new Set<ProductSortDirection>(['asc', 'desc']);

export const defaultProductListFilters: ProductListFilters = {
  search: '',
  estado: 'activo',
  sortBy: 'nombre',
  sortDirection: 'asc',
};

export function normalizeProductListPayload(
  payload: unknown,
): ProductListFilters {
  if (!isRecord(payload)) {
    return defaultProductListFilters;
  }

  const search =
    typeof payload.search === 'string' ? payload.search.trim().slice(0, 100) : '';
  const estado = productStatusFilters.has(payload.estado as ProductStatusFilter)
    ? (payload.estado as ProductStatusFilter)
    : defaultProductListFilters.estado;
  const sortBy = productSortFields.has(payload.sortBy as ProductSortBy)
    ? (payload.sortBy as ProductSortBy)
    : defaultProductListFilters.sortBy;
  const sortDirection = productSortDirections.has(
    payload.sortDirection as ProductSortDirection,
  )
    ? (payload.sortDirection as ProductSortDirection)
    : defaultProductListFilters.sortDirection;
  const categoriaId =
    typeof payload.categoriaId === 'number' &&
    Number.isInteger(payload.categoriaId) &&
    payload.categoriaId > 0
      ? payload.categoriaId
      : undefined;

  return {
    search,
    estado,
    categoriaId,
    sortBy,
    sortDirection,
  };
}

export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value);
}

export function normalizeProductFormPayload(
  payload: unknown,
): ProductCreatePayload {
  const record = isRecord(payload) ? payload : {};

  return {
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
    ean13: typeof record.ean13 === 'string' ? record.ean13.trim() : '',
    nombre: typeof record.nombre === 'string' ? record.nombre.trim() : '',
    categoriaId: normalizeInteger(record.categoriaId),
    precioCosto: normalizeInteger(record.precioCosto),
    precioVenta: normalizeInteger(record.precioVenta),
    stockMinimo: normalizeInteger(record.stockMinimo),
  };
}

export function normalizeProductEditPayload(
  payload: unknown,
): ProductEditPayload {
  const record = isRecord(payload) ? payload : {};
  const formPayload = normalizeProductFormPayload(payload);

  return {
    ...formPayload,
    originalEan13:
      typeof record.originalEan13 === 'string' ? record.originalEan13.trim() : '',
  };
}

export function validateProductFormValues(
  values: ProductFormValues,
): ProductFieldErrors {
  const fieldErrors: ProductFieldErrors = {};

  if (!isValidEan13(values.ean13)) {
    fieldErrors.ean13 = invalidEan13Message;
  }

  if (!values.nombre) {
    fieldErrors.nombre = 'El nombre del producto es obligatorio.';
  }

  if (!Number.isInteger(values.categoriaId) || values.categoriaId <= 0) {
    fieldErrors.categoriaId = 'Seleccione una categoria valida.';
  }

  if (!Number.isInteger(values.precioCosto) || values.precioCosto < 0) {
    fieldErrors.precioCosto = 'El precio costo debe ser un entero mayor o igual a 0.';
  }

  if (!Number.isInteger(values.precioVenta) || values.precioVenta < 0) {
    fieldErrors.precioVenta = 'El precio venta debe ser un entero mayor o igual a 0.';
  }

  if (
    Number.isInteger(values.precioCosto) &&
    Number.isInteger(values.precioVenta) &&
    values.precioVenta <= values.precioCosto
  ) {
    fieldErrors.precioVenta = 'El precio venta debe ser mayor que el precio costo.';
  }

  if (!Number.isInteger(values.stockMinimo) || values.stockMinimo < 0) {
    fieldErrors.stockMinimo = 'El stock minimo debe ser un entero mayor o igual a 0.';
  }

  return fieldErrors;
}

export function hasProductFieldErrors(errors: ProductFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function filterAndSortProductList(
  products: ProductListItem[],
  filters: ProductListFilters,
): ProductListItem[] {
  const normalizedSearch = normalizeSearch(filters.search);
  const filtered = products.filter((product) => {
    const matchesStatus =
      filters.estado === 'todos' || product.estado === filters.estado;
    const matchesCategory =
      !filters.categoriaId || product.categoriaId === filters.categoriaId;
    const matchesSearch =
      normalizedSearch.length === 0 ||
      normalizeSearch(product.nombre).includes(normalizedSearch) ||
      normalizeSearch(product.categoria).includes(normalizedSearch) ||
      product.ean13.includes(normalizedSearch);

    return matchesStatus && matchesCategory && matchesSearch;
  });

  return filtered.sort((left, right) => {
    const comparison = compareProducts(left, right, filters.sortBy);
    return filters.sortDirection === 'asc' ? comparison : comparison * -1;
  });
}

function compareProducts(
  left: ProductListItem,
  right: ProductListItem,
  sortBy: ProductSortBy,
): number {
  if (sortBy === 'stockActual') {
    return left[sortBy] - right[sortBy];
  }

  return left[sortBy].localeCompare(right[sortBy], 'es');
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeInteger(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
  }

  return Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
