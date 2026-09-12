import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import type { AttendanceWorkerOption } from "../../../src/shared/attendance";
import type { Role } from "../../../src/shared/navigation";
import {
  defaultUserListFilters,
  filterAndSortUserList,
  normalizeUserListPayload,
  type UserFormValues,
  type UserListItem,
  type UserListResponse,
  type UserStatusChangePayload,
} from "../../../src/shared/users";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";
import {
  authorizeRequest,
  guardChannel,
} from "../../../src/main/controllers/auth-guard";
import { verifySessionToken } from "../../../src/main/controllers/auth-jwt";
import { registerAuditLog } from "../../../src/main/controllers/auth-context";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import {
  createWorkerController,
  listWorkersWithExecutor,
  updateWorkerWithExecutor,
} from "../../../src/main/controllers/worker";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

const workers: UserListItem[] = [
  {
    usuarioId: "12345678-9",
    rut: "12345678-9",
    nombreCompleto: "Maria Huascar",
    rol: "dueno",
    telefono: "987654321",
    correoElectronico: "maria@huascar.cl",
    fechaIngreso: "2024-01-01",
    estado: "activo",
  },
  {
    usuarioId: "23456789-0",
    rut: "23456789-0",
    nombreCompleto: "Camila Rojas",
    rol: "trabajador",
    telefono: "912345678",
    fechaIngreso: "2025-06-15",
    estado: "activo",
  },
];

const activeWorkers = workers.map((worker, index) => ({
  trabajadorId: index + 1,
  rut: worker.rut,
  nombreCompleto: worker.nombreCompleto,
}));

function createController(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    authorize: async (usuarioId, allowedRoles, sesionRol) =>
      authorizeTestUser(usuarioId, allowedRoles, sesionRol),
    changeStatus: async (payload) => ({
      usuarioId: payload.usuarioObjetivoId,
    }),
    createWorker: async (payload) => ({ usuarioId: payload.rut }),
    listActiveWorkers: async () => activeWorkers,
    listWorkers: async (filters) => filterAndSortUserList(workers, filters),
    updateWorker: async (payload) => ({ usuarioId: payload.rut }),
    ...overrides,
  };

  return createWorkerController(dependencies);
}

describe("worker controller", () => {
  it("lists workers for owners", async () => {
    const response = await createController().handle(
      { usuarioId: "dueno", search: "rojas" },
      { channel: "trabajador:listar" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(
      (response.data as UserListResponse).users.map((worker) => worker.rut),
    ).toEqual(["23456789-0"]);
  });

  it("lists the same data for worker sessions (CU24)", async () => {
    const response = await createController().handle(
      { usuarioId: "trabajador" },
      { channel: "trabajador:listar" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect(
      (response.data as UserListResponse).users.map((worker) => worker.rut),
    ).toEqual(["23456789-0", "12345678-9"]);
  });

  it("passes the normalized filters to the persistence layer and sorts by column", async () => {
    const listWorkers = vi.fn(async () => [...workers].reverse());
    const response = await createController({ listWorkers }).handle(
      {
        usuarioId: "dueno",
        search: "Rojas",
        rol: "todos",
        estado: "todos",
        sortBy: "rol",
        sortDirection: "desc",
      },
      { channel: "trabajador:listar" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    expect(listWorkers).toHaveBeenCalledWith({
      search: "Rojas",
      rol: "todos",
      estado: "todos",
      sortBy: "rol",
      sortDirection: "desc",
    });
    expect(
      (response.data as UserListResponse).users.map((worker) => worker.rol),
    ).toEqual(["trabajador", "dueno"]);
  });

  it("still rejects worker sessions for worker administration", async () => {
    const response = await createController().handle(
      { usuarioId: "trabajador", nombreCompleto: "Ana Soto", rol: "trabajador", rut: "22222222-2", telefono: "987654321" },
      { channel: "trabajador:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden worker registration");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("authorizes mutations with the session role attached by the guard", async () => {
    const createWorker = vi.fn(async (payload: UserFormValues) => ({
      usuarioId: payload.rut,
    }));
    const response = await createController({ createWorker }).handle(
      {
        nombreCompleto: "Ana Soto",
        rol: "trabajador",
        rut: "22222222-2",
        telefono: "987654321",
        usuarioId: "trabajador",
        __rolSesion: "dueno",
      },
      { channel: "trabajador:registrar" },
    );

    expect(response.ok).toBe(true);
    expect(createWorker).toHaveBeenCalled();
  });

  it("creates worker accounts in the worker module", async () => {
    const createWorker = vi.fn(async (payload: UserFormValues) => ({
      usuarioId: payload.rut,
    }));
    const response = await createController({ createWorker }).handle(
      {
        correoElectronico: "ana@huascar.cl",
        nombreCompleto: "Ana Soto",
        rol: "trabajador",
        rut: "12.345.678-5",
        telefono: "987654321",
        usuarioId: "dueno",
      },
      { channel: "trabajador:registrar" },
    );

    expect(response.ok).toBe(true);
    expect(createWorker).toHaveBeenCalledWith(
      {
        correoElectronico: "ana@huascar.cl",
        nombreCompleto: "Ana Soto",
        rol: "trabajador",
        rut: "12345678-5",
        telefono: "987654321",
        usuarioId: "dueno",
      },
      undefined,
    );
  });

  it("returns field errors for invalid worker creation payloads", async () => {
    const response = await createController().handle(
      {
        nombreCompleto: "",
        rol: "trabajador",
        rut: "123",
        telefono: "123",
        usuarioId: "dueno",
      },
      { channel: "trabajador:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected validation error");
    }

    expect(response.error.code).toBe("VALIDATION_ERROR");
    expect(response.error.fieldErrors?.rut).toBeDefined();
    expect(response.error.fieldErrors?.nombreCompleto).toBeDefined();
    expect(response.error.fieldErrors?.telefono).toBeDefined();
  });

  it("updates workers without revalidating non-editable legacy RUT checksums", async () => {
    const updateWorker = vi.fn(async (payload: UserFormValues) => ({
      usuarioId: payload.rut,
    }));
    const response = await createController({ updateWorker }).handle(
      {
        correoElectronico: "",
        nombreCompleto: "Maria Huascar Editada",
        rol: "dueno",
        rut: "12345678-9",
        telefono: "987654321",
        usuarioId: "dueno",
      },
      { channel: "trabajador:actualizar" },
    );

    expect(response.ok).toBe(true);
    expect(updateWorker).toHaveBeenCalled();
  });

  it("changes worker status after owner authorization", async () => {
    const changeStatus = vi.fn(async (payload: UserStatusChangePayload) => ({
      usuarioId: payload.usuarioObjetivoId,
    }));
    const response = await createController({ changeStatus }).handle(
      {
        estado: "inactivo",
        usuarioId: "dueno",
        usuarioObjetivoId: "23456789-0",
      },
      { channel: "trabajador:cambiar-estado" },
    );

    expect(response.ok).toBe(true);
    expect(changeStatus).toHaveBeenCalledWith(
      {
        estado: "inactivo",
        usuarioId: "dueno",
        usuarioObjetivoId: "23456789-0",
      },
      undefined,
    );
  });

  describe("trabajador:listar-activos", () => {
    it("returns every active worker for owners", async () => {
      const response = await createController().handle(
        { usuarioId: "12345678-9" },
        { channel: "trabajador:listar-activos" },
      );

      expect(response.ok).toBe(true);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      expect(response.data as AttendanceWorkerOption[]).toEqual(activeWorkers);
    });

    it("returns only the calling worker for the trabajador role", async () => {
      const response = await createController().handle(
        { usuarioId: "23456789-0" },
        { channel: "trabajador:listar-activos" },
      );

      expect(response.ok).toBe(true);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const data = response.data as AttendanceWorkerOption[];
      expect(data).toHaveLength(1);
      expect(data[0]?.rut).toBe("23456789-0");
      expect(data[0]?.nombreCompleto).toBe("Camila Rojas");
    });

    it("does not leak other workers rut or names to a trabajador", async () => {
      const response = await createController().handle(
        { usuarioId: "23456789-0" },
        { channel: "trabajador:listar-activos" },
      );

      expect(response.ok).toBe(true);
      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const data = response.data as AttendanceWorkerOption[];
      const ruts = data.map((worker) => worker.rut);
      const names = data.map((worker) => worker.nombreCompleto);

      expect(ruts).not.toContain("12345678-9");
      expect(names).not.toContain("Maria Huascar");
    });
  });
});

type Dependencies = NonNullable<Parameters<typeof createWorkerController>[0]>;

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
  sesionRol?: Role,
): AuthenticatedUser {
  const role = sesionRol ?? resolveTestRole(usuarioId);

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? "",
    usuarioRol: role,
    trabajadorNombre: role === "dueno" ? "Dueno Prueba" : "Trabajador Prueba",
  };
}

function resolveTestRole(usuarioId: string | undefined): Role | null {
  if (usuarioId === "dueno") {
    return "dueno";
  }

  if (usuarioId === "trabajador") {
    return "trabajador";
  }

  const known = workers.find((worker) => worker.usuarioId === usuarioId);

  return known?.rol ?? null;
}

describe("listWorkersWithExecutor (CU24, D4: dos consultas en SQL)", () => {
  let testDb: AuthTestDatabase | undefined;

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
    await seedUser(testDb.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
      nombre: "María",
      apellido: "González",
    });
    await seedUser(testDb.db, {
      usuarioId: "23456789-0",
      trabajadorId: 2,
      rut: "23456789-0",
      rolBd: "trabajador",
      nombre: "Camila",
      apellido: "Rojas",
    });
    await seedUser(testDb.db, {
      usuarioId: "34567890-1",
      trabajadorId: 3,
      rut: "34567890-1",
      rolBd: "trabajador",
      nombre: "José",
      apellido: "Pérez",
      estado: "inactivo",
    });
  });

  afterEach(async () => {
    if (!testDb) {
      return;
    }
    testDb.client.close();
    await removeAuthTempDir(testDb.dir);
    testDb = undefined;
  });

  function filters(
    overrides: Partial<ReturnType<typeof normalizeUserListPayload>> = {},
  ): ReturnType<typeof normalizeUserListPayload> {
    return normalizeUserListPayload({ ...defaultUserListFilters, ...overrides });
  }

  async function ruts(
    overrides: Partial<ReturnType<typeof normalizeUserListPayload>> = {},
  ): Promise<string[]> {
    const users = await listWorkersWithExecutor(testDb!.db, schema, filters(overrides));
    return users.map((worker) => worker.rut);
  }

  it("returns every worker with account and role, ordered by name", async () => {
    await expect(ruts()).resolves.toEqual([
      "23456789-0",
      "34567890-1",
      "12345678-9",
    ]);
  });

  it("filters by a partial RUT in SQL", async () => {
    await expect(ruts({ search: "789-0" })).resolves.toEqual(["23456789-0"]);
  });

  it("matches names ignoring accents and case", async () => {
    await expect(ruts({ search: "jose" })).resolves.toEqual(["34567890-1"]);
    await expect(ruts({ search: "MARIA" })).resolves.toEqual(["12345678-9"]);
  });

  it("applies the role filter on the second query", async () => {
    await expect(ruts({ rol: "trabajador" })).resolves.toEqual([
      "23456789-0",
      "34567890-1",
    ]);
    await expect(ruts({ rol: "dueno" })).resolves.toEqual(["12345678-9"]);
  });

  it("applies the estado filter on the first query", async () => {
    await expect(ruts({ estado: "inactivo" })).resolves.toEqual([
      "34567890-1",
    ]);
    await expect(
      ruts({ rol: "trabajador", estado: "activo" }),
    ).resolves.toEqual(["23456789-0"]);
  });

  it("returns an empty list for a search without matches (CU24-E1)", async () => {
    await expect(ruts({ search: "zzzz" })).resolves.toEqual([]);
  });
});

describe("listar no concede editar (CU24)", () => {
  let testDb: AuthTestDatabase | undefined;

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
    await seedUser(testDb.db, {
      usuarioId: "23456789-0",
      trabajadorId: 2,
      rut: "23456789-0",
      rolBd: "trabajador",
    });
  });

  afterEach(async () => {
    if (!testDb) {
      return;
    }
    testDb.client.close();
    await removeAuthTempDir(testDb.dir);
    testDb = undefined;
  });

  it("forbids a worker invoking trabajador:actualizar directly over IPC", async () => {
    const token = signSessionToken({
      usuarioId: "23456789-0",
      rol: "trabajador",
      usuarioRol: "trabajador",
      passwordTemporal: false,
      sesionId: "00000000-0000-4000-8000-000000000777",
    });

    const result = await authorizeRequest(
      "trabajador:actualizar",
      {
        usuarioId: "23456789-0",
        nombreCompleto: "Camila Rojas",
        rol: "trabajador",
        rut: "23456789-0",
        telefono: "987654321",
        __authToken: token,
      },
      undefined,
      {
        identity: (channel, payload) =>
          guardChannel(channel, payload, {
            verifyToken: verifySessionToken,
            audit: (event) => registerAuditLog(testDb!.db, schema, event),
          }),
        session: async () => ({ active: true, rolEfectivo: "trabajador" }),
        audit: (event) => registerAuditLog(testDb!.db, schema, event),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.ok) {
      expect(result.response.error.code).toBe("FORBIDDEN");
    }

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_denegado'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });
});

describe("updateWorkerWithExecutor (CU22, D6)", () => {
  let testDb: AuthTestDatabase | undefined;
  const OWNER = "12345678-9";
  const TARGET = "23456789-0";

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
    await seedUser(testDb.db, {
      usuarioId: OWNER,
      trabajadorId: 1,
      rut: OWNER,
      rolBd: "dueno",
      nombre: "María",
      apellido: "González",
    });
    await seedUser(testDb.db, {
      usuarioId: TARGET,
      trabajadorId: 2,
      rut: TARGET,
      rolBd: "trabajador",
      nombre: "Camila",
      apellido: "Rojas",
    });
    await testDb.db.insert(schema.usuarioVersion).values({
      usuarioVersionNombre: "Camila Rojas",
      usuarioVersionRol: "trabajador",
      usuarioId: TARGET,
    });
    await testDb.db.insert(schema.sesionUsuario).values({
      sesionUsuarioId: "00000000-0000-4000-8000-000000000777",
      usuarioId: TARGET,
      sesionRolEfectivo: "trabajador",
      sesionFechaHoraInicio: "2026-06-13T12:00:00.000Z",
      sesionFechaHoraUltimoAcceso: "2026-06-13T12:00:00.000Z",
    });
  });

  afterEach(async () => {
    if (!testDb) {
      return;
    }
    testDb.client.close();
    await removeAuthTempDir(testDb.dir);
    testDb = undefined;
  });

  function basePayload(overrides: Partial<UserFormValues> = {}): UserFormValues {
    return {
      correoElectronico: "",
      nombreCompleto: "Camila Rojas",
      rol: "trabajador",
      rut: TARGET,
      telefono: "987654321",
      usuarioId: OWNER,
      ...overrides,
    };
  }

  it("updates worker data without touching usuario or usuario_version when the role stays", async () => {
    const response = await updateWorkerWithExecutor(
      testDb!.db,
      schema,
      basePayload({ nombreCompleto: "Camila Rojas Vargas", telefono: "912345678" }),
    );

    expect(response.usuarioId).toBe(TARGET);

    const [trabajador] = await testDb!.db
      .select()
      .from(schema.trabajador)
      .where(eq(schema.trabajador.trabajadorRut, TARGET));
    expect(trabajador.trabajadorNombre).toBe("Camila Rojas Vargas");
    expect(trabajador.trabajadorTelefono).toBe("912345678");

    const [cuenta] = await testDb!.db
      .select()
      .from(schema.usuario)
      .where(eq(schema.usuario.usuarioId, TARGET));
    expect(cuenta.usuarioRol).toBe("trabajador");

    const versiones = await testDb!.db
      .select()
      .from(schema.usuarioVersion)
      .where(eq(schema.usuarioVersion.usuarioId, TARGET));
    expect(versiones).toHaveLength(1);
    expect(versiones[0]?.usuarioVersionFechaHoraVigenciaHasta ?? null).toBeNull();

    const [sesion] = await testDb!.db
      .select()
      .from(schema.sesionUsuario)
      .where(eq(schema.sesionUsuario.usuarioId, TARGET));
    expect(sesion.sesionRolEfectivo).toBe("trabajador");

    const [auditoria] = await testDb!.db
      .select({ descripcion: schema.logAuditoria.logDescripcion })
      .from(schema.logAuditoria)
      .where(sql`log_descripcion LIKE '%23456789-0%'`);
    expect(auditoria.descripcion).toContain("campos: nombre, telefono");
  });

  it("updates the account and rotates the version only when the role changes", async () => {
    const response = await updateWorkerWithExecutor(
      testDb!.db,
      schema,
      basePayload({ rol: "dueno" }),
    );

    expect(response.usuarioId).toBe(TARGET);

    const [cuenta] = await testDb!.db
      .select()
      .from(schema.usuario)
      .where(eq(schema.usuario.usuarioId, TARGET));
    expect(cuenta.usuarioRol).toBe("dueno");

    const versiones = await testDb!.db
      .select()
      .from(schema.usuarioVersion)
      .where(eq(schema.usuarioVersion.usuarioId, TARGET));
    expect(versiones).toHaveLength(2);
    const cerrada = versiones.find((v) => v.usuarioVersionRol === "trabajador");
    const nueva = versiones.find((v) => v.usuarioVersionRol === "dueno");
    expect(cerrada?.usuarioVersionFechaHoraVigenciaHasta ?? null).not.toBeNull();
    expect(nueva?.usuarioVersionFechaHoraVigenciaHasta ?? null).toBeNull();

    const [sesion] = await testDb!.db
      .select()
      .from(schema.sesionUsuario)
      .where(eq(schema.sesionUsuario.usuarioId, TARGET));
    expect(sesion.sesionRolEfectivo).toBe("trabajador");

    const [auditoria] = await testDb!.db
      .select({ descripcion: schema.logAuditoria.logDescripcion })
      .from(schema.logAuditoria)
      .where(sql`log_descripcion LIKE '%23456789-0%'`);
    expect(auditoria.descripcion).toContain("rol");
  });

  it("rejects an unregistered RUT without writing anything (E1)", async () => {
    await expect(
      updateWorkerWithExecutor(
        testDb!.db,
        schema,
        basePayload({ rut: "99999999-9" }),
      ),
    ).rejects.toThrow("No se encontro el trabajador solicitado.");

    const auditorias = await testDb!.db.select().from(schema.logAuditoria);
    expect(auditorias).toHaveLength(0);
  });

  it("authorizes before validating fields, as the diagram orders (CU22-E2)", async () => {
    const updateWorker = vi.fn(async (payload: UserFormValues) => ({
      usuarioId: payload.rut,
    }));
    const invalido = {
      nombreCompleto: "",
      rol: "trabajador" as const,
      rut: TARGET,
      telefono: "123",
      usuarioId: "dueno",
    };

    const response = await createController({ updateWorker }).handle(
      invalido,
      { channel: "trabajador:actualizar" },
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.fieldErrors?.nombreCompleto).toBeDefined();
    }
    expect(updateWorker).not.toHaveBeenCalled();

    const sinPermiso = await createController({ updateWorker }).handle(
      { ...invalido, usuarioId: "trabajador" },
      { channel: "trabajador:actualizar" },
    );
    expect(sinPermiso.ok).toBe(false);
    if (!sinPermiso.ok) {
      expect(sinPermiso.error.code).toBe("FORBIDDEN");
    }
    expect(updateWorker).not.toHaveBeenCalled();
  });
});
