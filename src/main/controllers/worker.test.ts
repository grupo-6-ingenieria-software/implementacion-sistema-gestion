import { describe, expect, it, vi } from 'vitest';
import type { AttendanceWorkerOption } from '../../shared/attendance';
import type { Role } from '../../shared/navigation';
import type {
  UserFormValues,
  UserListItem,
  UserListResponse,
  UserStatusChangePayload,
} from '../../shared/users';
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from './auth-context';
import { createWorkerController } from './worker';

const workers: UserListItem[] = [
  {
    usuarioId: '12345678-9',
    rut: '12345678-9',
    nombreCompleto: 'Maria Huascar',
    rol: 'dueno',
    telefono: '987654321',
    correoElectronico: 'maria@huascar.cl',
    fechaIngreso: '2024-01-01',
    estado: 'activo',
  },
  {
    usuarioId: '23456789-0',
    rut: '23456789-0',
    nombreCompleto: 'Camila Rojas',
    rol: 'trabajador',
    telefono: '912345678',
    fechaIngreso: '2025-06-15',
    estado: 'activo',
  },
];

const activeWorkers = workers.map((worker, index) => ({
  trabajadorId: index + 1,
  rut: worker.rut,
  nombreCompleto: worker.nombreCompleto,
}));

function createController(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    changeStatus: async (payload) => ({
      usuarioId: payload.usuarioObjetivoId,
    }),
    createWorker: async (payload) => ({ usuarioId: payload.rut }),
    listActiveWorkers: async () => activeWorkers,
    listWorkers: async () => workers,
    updateWorker: async (payload) => ({ usuarioId: payload.rut }),
    ...overrides,
  };

  return createWorkerController(dependencies);
}

describe('worker controller', () => {
  it('lists workers for owners', async () => {
    const response = await createController().handle(
      { usuarioId: 'dueno', search: 'rojas' },
      { channel: 'trabajador:listar' },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect((response.data as UserListResponse).users.map((worker) => worker.rut))
      .toEqual(['23456789-0']);
  });

  it('rejects worker sessions for worker administration', async () => {
    const response = await createController().handle(
      { usuarioId: 'trabajador' },
      { channel: 'trabajador:listar' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected forbidden worker list');
    }

    expect(response.error.code).toBe('FORBIDDEN');
  });

  it('creates worker accounts in the worker module', async () => {
    const createWorker = vi.fn(async (payload: UserFormValues) => ({
      usuarioId: payload.rut,
    }));
    const response = await createController({ createWorker }).handle(
      {
        correoElectronico: 'ana@huascar.cl',
        nombreCompleto: 'Ana Soto',
        rol: 'trabajador',
        rut: '12.345.678-5',
        telefono: '987654321',
        usuarioId: 'dueno',
      },
      { channel: 'trabajador:registrar' },
    );

    expect(response.ok).toBe(true);
    expect(createWorker).toHaveBeenCalledWith({
      correoElectronico: 'ana@huascar.cl',
      nombreCompleto: 'Ana Soto',
      rol: 'trabajador',
      rut: '12345678-5',
      telefono: '987654321',
      usuarioId: 'dueno',
    });
  });

  it('returns field errors for invalid worker creation payloads', async () => {
    const response = await createController().handle(
      {
        nombreCompleto: '',
        rol: 'trabajador',
        rut: '123',
        telefono: '123',
        usuarioId: 'dueno',
      },
      { channel: 'trabajador:registrar' },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error('Expected validation error');
    }

    expect(response.error.code).toBe('VALIDATION_ERROR');
    expect(response.error.fieldErrors?.rut).toBeDefined();
    expect(response.error.fieldErrors?.nombreCompleto).toBeDefined();
    expect(response.error.fieldErrors?.telefono).toBeDefined();
  });

  it('updates workers without revalidating non-editable legacy RUT checksums', async () => {
    const updateWorker = vi.fn(async (payload: UserFormValues) => ({
      usuarioId: payload.rut,
    }));
    const response = await createController({ updateWorker }).handle(
      {
        correoElectronico: '',
        nombreCompleto: 'Maria Huascar Editada',
        rol: 'dueno',
        rut: '12345678-9',
        telefono: '987654321',
        usuarioId: 'dueno',
      },
      { channel: 'trabajador:actualizar' },
    );

    expect(response.ok).toBe(true);
    expect(updateWorker).toHaveBeenCalled();
  });

  it('changes worker status after owner authorization', async () => {
    const changeStatus = vi.fn(async (payload: UserStatusChangePayload) => ({
      usuarioId: payload.usuarioObjetivoId,
    }));
    const response = await createController({ changeStatus }).handle(
      {
        estado: 'inactivo',
        usuarioId: 'dueno',
        usuarioObjetivoId: '23456789-0',
      },
      { channel: 'trabajador:cambiar-estado' },
    );

    expect(response.ok).toBe(true);
    expect(changeStatus).toHaveBeenCalledWith({
      estado: 'inactivo',
      usuarioId: 'dueno',
      usuarioObjetivoId: '23456789-0',
    });
  });

  describe('trabajador:listar-activos', () => {
    it('returns every active worker for owners', async () => {
      const response = await createController().handle(
        { usuarioId: '12345678-9' },
        { channel: 'trabajador:listar-activos' },
      );

      expect(response.ok).toBe(true);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      expect(response.data as AttendanceWorkerOption[]).toEqual(activeWorkers);
    });

    it('returns only the calling worker for the trabajador role', async () => {
      const response = await createController().handle(
        { usuarioId: '23456789-0' },
        { channel: 'trabajador:listar-activos' },
      );

      expect(response.ok).toBe(true);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const data = response.data as AttendanceWorkerOption[];
      expect(data).toHaveLength(1);
      expect(data[0]?.rut).toBe('23456789-0');
      expect(data[0]?.nombreCompleto).toBe('Camila Rojas');
    });

    it('does not leak other workers rut or names to a trabajador', async () => {
      const response = await createController().handle(
        { usuarioId: '23456789-0' },
        { channel: 'trabajador:listar-activos' },
      );

      expect(response.ok).toBe(true);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const data = response.data as AttendanceWorkerOption[];
      const ruts = data.map((worker) => worker.rut);
      const names = data.map((worker) => worker.nombreCompleto);

      expect(ruts).not.toContain('12345678-9');
      expect(names).not.toContain('Maria Huascar');
    });
  });
});

type Dependencies = NonNullable<Parameters<typeof createWorkerController>[0]>;

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role = resolveTestRole(usuarioId);

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? '',
    usuarioRol: role,
    trabajadorNombre: role === 'dueno' ? 'Dueno Prueba' : 'Trabajador Prueba',
  };
}

// Identidades de sesion para las pruebas: ademas de los alias 'dueno'/'trabajador',
// se reconocen los RUT de la fixture `workers` (usuarioId == RUT) para poder
// ejercitar el self-scoping del canal por RUT real.
function resolveTestRole(usuarioId: string | undefined): Role | null {
  if (usuarioId === 'dueno') {
    return 'dueno';
  }

  if (usuarioId === 'trabajador') {
    return 'trabajador';
  }

  const known = workers.find((worker) => worker.usuarioId === usuarioId);

  return known?.rol ?? null;
}
