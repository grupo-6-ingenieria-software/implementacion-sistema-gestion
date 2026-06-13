import { isValidRutFormat, normalizeRut } from './attendance';

export type WorkerRole = 'dueno' | 'trabajador';
export type WorkerStatus = 'activo' | 'inactivo';

export type WorkerListFilters = {
  estado?: WorkerStatus | 'todos';
  rol?: WorkerRole | 'todos';
  search?: string;
  usuarioId?: string;
};

export type WorkerListItem = {
  trabajadorId: number;
  rut: string;
  nombreCompleto: string;
  rol: WorkerRole;
  telefono: string;
  correo: string | null;
  fechaIngreso: string;
  estado: WorkerStatus;
};

export type WorkerListResponse = {
  workers: WorkerListItem[];
};

export type WorkerFormValues = {
  rut: string;
  nombreCompleto: string;
  rol: WorkerRole;
  telefono: string;
  correo?: string;
};

export type WorkerCreatePayload = WorkerFormValues & {
  usuarioId?: string;
};

export type WorkerEditPayload = Omit<WorkerFormValues, 'rut'> & {
  rut: string;
  usuarioId?: string;
};

export type WorkerStatusPayload = {
  rut?: string;
  estado?: WorkerStatus;
  usuarioId?: string;
};

export type WorkerFieldErrors = Partial<
  Record<'rut' | 'nombreCompleto' | 'rol' | 'telefono' | 'correo', string>
>;

export type WorkerCreateResponse = {
  trabajador: WorkerListItem;
  credenciales: {
    usuario: string;
    contrasenaTemporal: string;
  };
};

export type WorkerMutationResponse = {
  trabajador: WorkerListItem;
};

export const emptyWorkerForm: WorkerFormValues = {
  rut: '',
  nombreCompleto: '',
  rol: 'trabajador',
  telefono: '',
  correo: '',
};

export function normalizeWorkerFormValues(
  payload: unknown,
): WorkerFormValues {
  if (!isObject(payload)) {
    return emptyWorkerForm;
  }

  return {
    rut: typeof payload.rut === 'string' ? normalizeRut(payload.rut) : '',
    nombreCompleto:
      typeof payload.nombreCompleto === 'string'
        ? payload.nombreCompleto.trim().replace(/\s+/g, ' ')
        : '',
    rol: payload.rol === 'dueno' ? 'dueno' : 'trabajador',
    telefono:
      typeof payload.telefono === 'string'
        ? payload.telefono.replace(/\D/g, '')
        : '',
    correo:
      typeof payload.correo === 'string' ? payload.correo.trim() : undefined,
  };
}

export function normalizeWorkerCreatePayload(
  payload: unknown,
): WorkerCreatePayload {
  const values = normalizeWorkerFormValues(payload);

  return {
    ...values,
    usuarioId: getOptionalString(payload, 'usuarioId'),
  };
}

export function normalizeWorkerEditPayload(
  payload: unknown,
): WorkerEditPayload {
  const values = normalizeWorkerFormValues(payload);

  return {
    ...values,
    usuarioId: getOptionalString(payload, 'usuarioId'),
  };
}

export function normalizeWorkerListFilters(
  payload: unknown,
): Required<Pick<WorkerListFilters, 'estado' | 'rol' | 'search'>> & {
  usuarioId?: string;
} {
  if (!isObject(payload)) {
    return {
      estado: 'todos',
      rol: 'todos',
      search: '',
    };
  }

  return {
    estado:
      payload.estado === 'activo' || payload.estado === 'inactivo'
        ? payload.estado
        : 'todos',
    rol:
      payload.rol === 'dueno' || payload.rol === 'trabajador'
        ? payload.rol
        : 'todos',
    search:
      typeof payload.search === 'string'
        ? payload.search.trim().toLocaleLowerCase('es')
        : '',
    usuarioId: getOptionalString(payload, 'usuarioId'),
  };
}

export function normalizeWorkerStatusPayload(
  payload: unknown,
): WorkerStatusPayload {
  return {
    rut: getOptionalString(payload, 'rut')
      ? normalizeRut(getOptionalString(payload, 'rut') ?? '')
      : undefined,
    estado: isObject(payload)
      ? payload.estado === 'activo' || payload.estado === 'inactivo'
        ? payload.estado
        : undefined
      : undefined,
    usuarioId: getOptionalString(payload, 'usuarioId'),
  };
}

export function validateWorkerFormValues(
  values: WorkerFormValues,
): WorkerFieldErrors {
  const errors: WorkerFieldErrors = {};

  if (!isValidRutFormat(values.rut)) {
    errors.rut = 'Ingrese un RUT valido.';
  }

  if (!values.nombreCompleto.trim()) {
    errors.nombreCompleto = 'Ingrese el nombre completo.';
  }

  if (values.rol !== 'dueno' && values.rol !== 'trabajador') {
    errors.rol = 'Seleccione un rol valido.';
  }

  if (!/^[0-9]{9}$/.test(values.telefono)) {
    errors.telefono = 'Ingrese un telefono de 9 digitos.';
  }

  const correo = values.correo?.trim();

  if (correo && correo.length > 50) {
    errors.correo = 'El correo no puede superar 50 caracteres.';
  } else if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    errors.correo = 'Ingrese un correo valido.';
  }

  return errors;
}

export function hasWorkerFieldErrors(errors: WorkerFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

export function roleLabel(role: WorkerRole): string {
  return role === 'dueno' ? 'Dueno' : 'Trabajador';
}

function getOptionalString(payload: unknown, key: string): string | undefined {
  if (!isObject(payload)) {
    return undefined;
  }

  const value = payload[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
