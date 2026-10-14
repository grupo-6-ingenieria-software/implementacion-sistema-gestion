import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "../../../src/shared/navigation";
import type {
  UserListItem,
  UserListResponse,
  UserPasswordResetRequestResponse,
} from "../../../src/shared/users";
import * as schema from "../../../src/db/schema";
import {
  AccessDeniedError,
  authorizeUser,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";
import {
  resetPasswordWithExecutor,
  type PasswordDeps,
} from "../../../src/main/controllers/password";
import { createUserManagementController } from "../../../src/main/controllers/user-management";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

const users: UserListItem[] = [
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

function createController() {
  return createUserManagementController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    listUsers: async () => users,
    requestPasswordReset: async (payload) => ({
      ok: true,
      data: {
        estado: "completado",
        contrasenaTemporal: "TmpPass1",
        usuarioObjetivoId: payload.usuarioObjetivoId,
      },
    }),
  });
}

describe("controlador de gestión de usuarios", () => {
  it("lista usuarios para sesiones de dueño", async () => {
    const response = await createController().handle(
      { usuarioId: "dueno" },
      { channel: "usuario:listar" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    expect((response.data as UserListResponse).users).toHaveLength(2);
  });

  it("rechaza sesiones de trabajador", async () => {
    const response = await createController().handle(
      { usuarioId: "trabajador" },
      { channel: "usuario:listar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden user list");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("aplica filtros al listado de usuarios", async () => {
    const response = await createController().handle(
      {
        usuarioId: "dueno",
        search: "rojas",
        rol: "trabajador",
        estado: "activo",
      },
      { channel: "usuario:listar" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    const data = response.data as UserListResponse;

    expect(data.users.map((user) => user.usuarioId)).toEqual(["23456789-0"]);
  });

  it("genera una contraseña temporal mediante el generador de restablecimiento de autenticación", async () => {
    const response = await createController().handle(
      {
        usuarioId: "dueno",
        usuarioObjetivoId: "23456789-0",
      },
      { channel: "usuario:solicitar-restablecimiento" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    const data = response.data as UserPasswordResetRequestResponse;
    expect(data.estado).toBe("completado");
    expect(data.contrasenaTemporal).toBe("TmpPass1");
    expect(data.usuarioObjetivoId).toBe("23456789-0");
  });

  it("no expone la creación de trabajadores a través del módulo de usuarios", async () => {
    const response = await createController().handle(
      { usuarioId: "dueno" },
      { channel: "usuario:crear-trabajador" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected invalid channel");
    }

    expect(response.error.code).toBe("INVALID_CHANNEL");
  });
});

describe("conexión del restablecimiento de contraseña de usuarios (RF58)", () => {
  const NOW = new Date("2026-06-13T12:00:00.000Z");
  const deps: PasswordDeps = {
    hashPassword: async (plain: string) => `hash:${plain}`,
    comparePassword: async () => false,
    generateTempPassword: () => "TmpPass1",
    now: () => NOW,
  };

  let testDb: AuthTestDatabase | undefined;

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
    await seedUser(testDb.db, {
      usuarioId: "11111111-1",
      trabajadorId: 1,
      rut: "11111111-1",
      rolBd: "dueno",
    });
    await seedUser(testDb.db, {
      usuarioId: "22222222-2",
      trabajadorId: 2,
      rut: "22222222-2",
      rolBd: "trabajador",
      nombre: "Camila",
      apellido: "Rojas",
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

  function createDbBackedController() {
    return createUserManagementController({
      authorize: async () => {
        throw new Error("authorize should not be used for the reset channel");
      },
      listUsers: async () => [],
      requestPasswordReset: async (payload) =>
        resetPasswordWithExecutor(
          testDb!.db,
          schema,
          {
            usuarioId: payload.usuarioId,
            usuarioObjetivoId: payload.usuarioObjetivoId,
          },
          deps,
        ).then((result) =>
          result.ok
            ? {
                ok: true as const,
                data: {
                  estado: "completado" as const,
                  contrasenaTemporal: result.data.contrasenaTemporal,
                  usuarioObjetivoId: result.data.usuarioObjetivoId,
                },
              }
            : result,
        ),
    });
  }

  it.each([
    { persisted: "trabajador" as const, effective: "dueno" as const, allowed: true },
    { persisted: "dueno" as const, effective: "trabajador" as const, allowed: false },
  ])("autoriza el listado con rol efectivo $effective aunque el persistido sea $persisted", async ({ persisted, effective, allowed }) => {
    const usuarioId = "11111111-1";
    await testDb!.db.run(sql`UPDATE usuario SET usuario_rol = ${persisted} WHERE usuario_id = ${usuarioId}`);
    const controller = createUserManagementController({
      authorize: (id, roles, sessionRole) => authorizeUser(testDb!.db, schema, id, roles, sessionRole),
      listUsers: async () => users,
      requestPasswordReset: async () => ({ ok: false, error: { code: "FORBIDDEN", message: "No usado" } }),
    });
    const response = await controller.handle({ usuarioId }, {
      channel: "usuario:listar",
      claims: { usuarioId, rol: effective, usuarioRol: effective, passwordTemporal: false, sesionId: "sesion" },
    });
    expect(response.ok).toBe(allowed);
    if (!response.ok) expect(response.error.code).toBe("FORBIDDEN");
  });

  it("permite que un solicitante dueno cree un registro de contraseña temporal de 24h", async () => {
    const response = await createDbBackedController().handle(
      { usuarioId: "11111111-1", usuarioObjetivoId: "22222222-2" },
      { channel: "usuario:solicitar-restablecimiento" },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(response.error.message);
    }

    const data = response.data as UserPasswordResetRequestResponse;
    expect(data.estado).toBe("completado");
    expect(data.contrasenaTemporal).toBe("TmpPass1");

    const rows = await testDb!.db.all<{
      temporales: number;
      expiraciones: number;
      expiracion: string | null;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM contrasena c JOIN contrasena_temporal t ON t.contrasena_id = c.contrasena_id WHERE c.usuario_id = '22222222-2') AS temporales,
        (SELECT COUNT(*) FROM contrasena_temporal) AS expiraciones,
        (SELECT contrasena_temporal_fecha_hora_expiracion FROM contrasena_temporal LIMIT 1) AS expiracion
    `);

    expect(rows[0].temporales).toBe(1);
    expect(rows[0].expiraciones).toBe(1);
    // Expiración a 24h del momento de generación.
    expect(rows[0].expiracion).toBe("2026-06-14T12:00:00.000Z");
  });

  it("rechaza a un solicitante que no sea dueno", async () => {
    const response = await createDbBackedController().handle(
      { usuarioId: "22222222-2", usuarioObjetivoId: "11111111-1" },
      { channel: "usuario:solicitar-restablecimiento" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden password reset");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });
});

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role =
    usuarioId === "dueno"
      ? "dueno"
      : usuarioId === "trabajador"
        ? "trabajador"
        : null;

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
