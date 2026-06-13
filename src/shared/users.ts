export type UserRole = 'dueno' | 'trabajador';
export type UserStatus = 'activo' | 'inactivo';

export type UserListItem = {
  usuarioId: string;
  rut: string;
  nombreCompleto: string;
  rol: UserRole;
  telefono: string;
  correoElectronico?: string;
  fechaIngreso: string;
  estado: UserStatus;
  ultimoLoginFechaHora?: string;
};

export type UserFormValues = {
  correoElectronico?: string;
  nombreCompleto: string;
  rol: UserRole;
  rut: string;
  telefono: string;
  usuarioId?: string;
};

export type UserFieldErrors = Partial<
  Record<'correoElectronico' | 'nombreCompleto' | 'rol' | 'rut' | 'telefono', string>
>;

export type UserMutationResponse = {
  usuarioId: string;
};

export type UserStatusChangePayload = {
  estado: UserStatus;
  usuarioId?: string;
  usuarioObjetivoId: string;
};

export type UserPasswordResetRequestPayload = {
  usuarioId?: string;
  usuarioObjetivoId: string;
};

export type UserPasswordResetRequestResponse = {
  estado: 'completado';
  contrasenaTemporal: string;
  usuarioObjetivoId: string;
};

export type UserRoleFilter = UserRole | 'todos';
export type UserStatusFilter = UserStatus | 'todos';
export type UserSortBy = 'nombreCompleto' | 'rol' | 'estado' | 'fechaIngreso';
export type UserSortDirection = 'asc' | 'desc';

export type UserListFilters = {
  search?: string;
  rol?: UserRoleFilter;
  estado?: UserStatusFilter;
  sortBy: UserSortBy;
  sortDirection: UserSortDirection;
};

export type UserListResponse = {
  users: UserListItem[];
};

export const defaultUserListFilters: UserListFilters = {
  rol: 'todos',
  estado: 'todos',
  sortBy: 'nombreCompleto',
  sortDirection: 'asc',
};

export function normalizeUserFormPayload(payload: unknown): UserFormValues {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const rol = normalizeUserRole(record.rol) ?? 'trabajador';

  return {
    correoElectronico:
      typeof record.correoElectronico === 'string'
        ? record.correoElectronico.trim()
        : undefined,
    nombreCompleto:
      typeof record.nombreCompleto === 'string'
        ? normalizeWhitespace(record.nombreCompleto)
        : '',
    rol,
    rut: typeof record.rut === 'string' ? normalizeRut(record.rut) : '',
    telefono:
      typeof record.telefono === 'string'
        ? record.telefono.replace(/\D/g, '')
        : '',
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
  };
}

export function normalizeUserStatusChangePayload(
  payload: unknown,
): UserStatusChangePayload {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  return {
    estado: record.estado === 'inactivo' ? 'inactivo' : 'activo',
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
    usuarioObjetivoId:
      typeof record.usuarioObjetivoId === 'string'
        ? record.usuarioObjetivoId.trim()
        : '',
  };
}

export function normalizeUserPasswordResetPayload(
  payload: unknown,
): UserPasswordResetRequestPayload {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  return {
    usuarioId:
      typeof record.usuarioId === 'string' ? record.usuarioId.trim() : undefined,
    usuarioObjetivoId:
      typeof record.usuarioObjetivoId === 'string'
        ? record.usuarioObjetivoId.trim()
        : '',
  };
}

export function validateUserFormValues(
  values: UserFormValues,
  options: { validateRutFormat?: boolean } = { validateRutFormat: true },
): UserFieldErrors {
  const errors: UserFieldErrors = {};

  if (!values.rut) {
    errors.rut = 'Ingrese el RUT del trabajador.';
  } else if (options.validateRutFormat !== false && !isValidRut(values.rut)) {
    errors.rut = 'Ingrese un RUT valido.';
  }

  if (!values.nombreCompleto) {
    errors.nombreCompleto = 'Ingrese el nombre completo.';
  } else if (values.nombreCompleto.length > 100) {
    errors.nombreCompleto = 'El nombre completo no puede superar 100 caracteres.';
  }

  if (values.rol !== 'dueno' && values.rol !== 'trabajador') {
    errors.rol = 'Seleccione un rol valido.';
  }

  if (!values.telefono) {
    errors.telefono = 'Ingrese el telefono de contacto.';
  } else if (!/^\d{9}$/.test(values.telefono)) {
    errors.telefono = 'El telefono debe tener 9 digitos numericos.';
  }

  if (
    values.correoElectronico &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.correoElectronico)
  ) {
    errors.correoElectronico = 'Ingrese un correo electronico valido.';
  }

  return errors;
}

export function hasUserFieldErrors(errors: UserFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

export function normalizeUserListPayload(payload: unknown): UserListFilters {
  if (typeof payload !== 'object' || payload === null) {
    return defaultUserListFilters;
  }

  const record = payload as Record<string, unknown>;
  const rol = normalizeRoleFilter(record.rol);
  const estado = normalizeStatusFilter(record.estado);
  const sortBy = normalizeSortBy(record.sortBy);
  const sortDirection = normalizeSortDirection(record.sortDirection);

  return {
    search: typeof record.search === 'string' ? record.search.trim() : undefined,
    rol,
    estado,
    sortBy,
    sortDirection,
  };
}

export function filterAndSortUserList(
  users: readonly UserListItem[],
  filters: UserListFilters,
): UserListItem[] {
  const search = normalizeSearch(filters.search);
  const filtered = users.filter((user) => {
    if (filters.rol && filters.rol !== 'todos' && user.rol !== filters.rol) {
      return false;
    }

    if (
      filters.estado &&
      filters.estado !== 'todos' &&
      user.estado !== filters.estado
    ) {
      return false;
    }

    if (!search) {
      return true;
    }

    return [
      user.usuarioId,
      user.rut,
      user.nombreCompleto,
      user.telefono,
      user.correoElectronico ?? '',
    ].some((value) => normalizeSearch(value).includes(search));
  });

  return filtered.sort((left, right) => {
    const direction = filters.sortDirection === 'desc' ? -1 : 1;
    const leftValue = getSortValue(left, filters.sortBy);
    const rightValue = getSortValue(right, filters.sortBy);

    return leftValue.localeCompare(rightValue, 'es') * direction;
  });
}

export function normalizeUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeSearch(value);

  if (normalized.includes('duen')) {
    return 'dueno';
  }

  if (
    normalized === 'trabajador' ||
    normalized === 'cajero' ||
    normalized === 'reponedor'
  ) {
    return 'trabajador';
  }

  return null;
}

export function normalizeRut(value: string): string {
  return value.replace(/\./g, '').replace(/\s/g, '').toUpperCase();
}

/**
 * Formatea dinámicamente un RUT mientras se escribe: conserva solo los dígitos
 * y el dígito verificador (0-9 o K) e inserta el guion automáticamente antes
 * del último carácter. Cualquier guion que ingrese el usuario se ignora; el
 * guion se gestiona solo y se reubica a medida que se escribe.
 */
export function formatRutInput(value: string): string {
  const clean = rutToBackend(value);

  if (clean.length <= 1) {
    return clean;
  }

  return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

/**
 * Valor de RUT para el backend: solo dígitos y dígito verificador (sin guion,
 * sin puntos). Es la contraparte de formatRutInput, que es puramente visual.
 */
export function rutToBackend(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^0-9K]/g, '')
    .slice(0, 9);
}

export function formatRoleLabel(role: UserRole): string {
  return role === 'dueno' ? 'Dueño' : 'Trabajador';
}

function normalizeRoleFilter(value: unknown): UserRoleFilter {
  if (value === 'todos' || value === undefined) {
    return 'todos';
  }

  return normalizeUserRole(value) ?? 'todos';
}

function normalizeStatusFilter(value: unknown): UserStatusFilter {
  return value === 'activo' || value === 'inactivo' ? value : 'todos';
}

function normalizeSortBy(value: unknown): UserSortBy {
  return value === 'rol' || value === 'estado' || value === 'fechaIngreso'
    ? value
    : 'nombreCompleto';
}

function normalizeSortDirection(value: unknown): UserSortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}

function getSortValue(user: UserListItem, sortBy: UserSortBy): string {
  if (sortBy === 'rol') {
    return user.rol;
  }

  if (sortBy === 'estado') {
    return user.estado;
  }

  if (sortBy === 'fechaIngreso') {
    return user.fechaIngreso;
  }

  return normalizeSearch(user.nombreCompleto);
}

function normalizeSearch(value: string | undefined): string {
  return (value ?? '')
    .toLocaleLowerCase('es')
    .replace(/\u00e3\u00b1/g, 'n')
    .replace(/\u00e3\u0192\u00c2\u00b1/g, 'n')
    .replace(/\u00c3\u00b1/g, 'n')
    .replace(/\u00c3\u0192\u00c2\u00b1/g, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isValidRut(value: string): boolean {
  const normalized = normalizeRut(value);
  const match = /^(\d{7,8})-([\dK])$/.exec(normalized);

  if (!match) {
    return false;
  }

  const [, body, checkDigit] = match;
  let multiplier = 2;
  let sum = 0;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const expected =
    remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);

  return expected === checkDigit;
}
