import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  validateAccessWithExecutor,
  type AccessControlDeps,
} from "../../../src/main/controllers/access-control";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

function claimsFor(rol: "dueno" | "trabajador"): SessionTokenClaims {
  return {
    usuarioId: "12345678-9",
    rol,
    usuarioRol: rol === "dueno" ? "dueno" : "trabajador",
    passwordTemporal: false,
    sesionId: "00000000-0000-4000-8000-000000000777",
  };
}

function depsWith(token: SessionTokenClaims | null): AccessControlDeps {
  return { verifyToken: () => token };
}

let testDb: AuthTestDatabase | undefined;

beforeEach(async () => {
  testDb = await createAuthTestDatabase();
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeAuthTempDir(testDb.dir);
  testDb = undefined;
});

describe("validateAccessWithExecutor (RF56/CU57)", () => {
  it("forbids access without a valid token", async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "bad", ruta: "/app/inicio" },
      depsWith(null),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("FORBIDDEN");
    }
  });

  it("allows a route permitted for the role and audits the grant in Main", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "/app/inicio" },
      depsWith(claimsFor("dueno")),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.allowed).toBe(true);
    }

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_concedido'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });

  it("decides with the session role over the JWT role (D2)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    // JWT dueno con sesión congelada en trabajador: la ruta de solo Dueño se
    // niega con el rol de la sesión.
    const denied = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "/app/admin/usuarios", __rolSesion: "trabajador" },
      depsWith(claimsFor("dueno")),
    );

    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("FORBIDDEN");
    }

    // JWT trabajador con sesión congelada en dueno: se concede con el rol de
    // la sesión.
    const granted = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "/app/admin/usuarios", __rolSesion: "dueno" },
      depsWith(claimsFor("trabajador")),
    );

    expect(granted.ok).toBe(true);
    if (granted.ok) {
      expect(granted.data.role).toBe("dueno");
    }

    const rows = await testDb!.db.all<{ accion: string; total: number }>(
      sql`SELECT log_tipo_accion AS accion, COUNT(*) AS total FROM log_auditoria GROUP BY log_tipo_accion`,
    );
    const byAction = Object.fromEntries(
      rows.map((row) => [row.accion, Number(row.total)]),
    );
    expect(byAction).toEqual({
      acceso_concedido: 1,
      acceso_denegado: 1,
    });
  });

  it("falls back to the JWT role when the guard did not attach a session role", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "/app/inicio", __rolSesion: "invalido" },
      depsWith(claimsFor("dueno")),
    );

    expect(response.ok).toBe(true);
  });

  it("denies a route not permitted for the role and audits it", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "trabajador",
    });

    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "/app/admin/usuarios" },
      depsWith(claimsFor("trabajador")),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("FORBIDDEN");
    }

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_denegado'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });

  it("validates the route is present", async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "" },
      depsWith(claimsFor("dueno")),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns not found for an unknown route", async () => {
    const response = await validateAccessWithExecutor(
      testDb!.db,
      schema,
      { token: "t", ruta: "/app/no-existe" },
      depsWith(claimsFor("dueno")),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("NOT_FOUND");
    }
  });
});
