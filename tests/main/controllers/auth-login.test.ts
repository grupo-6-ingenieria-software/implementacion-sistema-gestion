import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  authenticateWithExecutor,
  type LoginDeps,
} from "../../../src/main/controllers/auth-login";
import {
  createAuthTestDatabase,
  insertLoginAttempt,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

const NOW = new Date("2026-06-13T12:00:00.000Z");

function makeDeps(matches: boolean): LoginDeps {
  return {
    comparePassword: async (plain: string) => matches && plain === "good",
    signToken: () => "jwt-token",
    now: () => NOW,
  };
}

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
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

describe("authenticateWithExecutor (CU56)", () => {
  it("consulta usuario → intentos → trabajador → contraseña y firma antes de insertar la sesión", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });
    const calls: string[] = [];
    const database = drizzle(testDb!.client, {
      schema,
      logger: {
        logQuery: (query) => {
          calls.push(query);
        },
      },
    });
    const result = await authenticateWithExecutor(
      database,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      {
        ...makeDeps(true),
        comparePassword: async () => {
          calls.push("bcrypt");
          return true;
        },
        signToken: (claims) => {
          expect(claims.sesionId).toMatch(/^[0-9a-f-]{36}$/);
          calls.push("sign");
          return "token";
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(
      calls.slice(0, 4).map((query) => query.match(/from "([^"]+)"/)?.[1]),
    ).toEqual(["usuario", "intento_login", "trabajador", "contrasena"]);
    expect(calls[4]).toBe("bcrypt");
    expect(calls.indexOf("sign")).toBeLessThan(
      calls.findIndex((query) =>
        query.startsWith('insert into "sesion_usuario"'),
      ),
    );
  });
  it("desbloquea al cumplirse el límite de quince minutos", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });
    for (let i = 0; i < 5; i++)
      await authenticateWithExecutor(
        testDb!.db,
        schema,
        { usuario: "12345678-9", contrasena: "wrong" },
        makeDeps(false),
      );
    const result = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      { ...makeDeps(true), now: () => new Date(NOW.getTime() + 15 * 60000) },
    );
    expect(result.ok).toBe(true);
  });
  it("comparte el bloqueo entre escrituras equivalentes del RUT y mantiene el mensaje genérico", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });
    for (const usuario of [
      "12345678-9",
      "12.345.678-9",
      "123456789",
      "12345678-9",
    ]) {
      await authenticateWithExecutor(
        testDb!.db,
        schema,
        { usuario, contrasena: "wrong" },
        makeDeps(false),
      );
    }
    const fifth = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12.345.678-9", contrasena: "wrong" },
      makeDeps(false),
    );
    expect(fifth).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("Usuario o contraseña incorrectos"),
      },
    });
    const blocked = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "123456789", contrasena: "good" },
      makeDeps(true),
    );
    expect(blocked).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("15 minutos") },
    });
  });

  it("resuelve la K minúscula a la misma cuenta almacenada y al mismo bloqueo", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-K",
      trabajadorId: 1,
      rut: "12345678-K",
    });
    for (const usuario of [
      "12345678-k",
      "12.345.678-k",
      "12345678K",
      "12345678-k",
      "12345678-K",
    ]) {
      await authenticateWithExecutor(
        testDb!.db,
        schema,
        { usuario, contrasena: "wrong" },
        makeDeps(false),
      );
    }
    expect(
      await authenticateWithExecutor(
        testDb!.db,
        schema,
        { usuario: "12345678k", contrasena: "good" },
        makeDeps(true),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: expect.stringContaining("Cuenta bloqueada"),
      },
    });
  });
  it("revierte los intentos exitosos cuando la firma falla antes de persistir la sesión", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });
    await expect(
      testDb!.db.transaction((tx) =>
        authenticateWithExecutor(
          tx,
          schema,
          { usuario: "12345678-9", contrasena: "good" },
          {
            ...makeDeps(true),
            signToken: () => {
              throw new Error("signing failed");
            },
          },
        ),
      ),
    ).rejects.toThrow("signing failed");
    expect(await testDb!.db.select().from(schema.sesionUsuario)).toHaveLength(
      0,
    );
    expect(await testDb!.db.select().from(schema.intentoLogin)).toHaveLength(0);
  });
  it("rechaza credenciales faltantes con un error de validación", async () => {
    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "", contrasena: "" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("autentica a un dueño válido y crea sesión, intento y registro de auditoría", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.token).toBe("jwt-token");
      expect(response.data.role).toBe("dueno");
      expect(response.data.passwordChangeRequired).toBe(false);
    }

    const counts = await testDb!.db.all<{
      sesiones: number;
      exitosos: number;
      auditorias: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM sesion_usuario) AS sesiones,
        (SELECT COUNT(*) FROM intento_login WHERE intento_exitoso = 1) AS exitosos,
        (SELECT COUNT(*) FROM log_auditoria) AS auditorias
    `);

    expect(counts[0]).toMatchObject({
      sesiones: 1,
      exitosos: 1,
      auditorias: 1,
    });

    // CU57 (D1): la sesión nace con el rol efectivo congelado.
    const [sesion] = await testDb!.db
      .select({ rol: schema.sesionUsuario.sesionRolEfectivo })
      .from(schema.sesionUsuario);
    expect(sesion?.rol).toBe("dueno");
  });

  it("devuelve el error genérico y registra un intento fallido ante contraseña incorrecta (e1)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "bad" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message).toBe("Usuario o contraseña incorrectos");
    }

    const failed = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM intento_login WHERE intento_exitoso = 0`,
    );
    expect(Number(failed[0]?.total)).toBe(1);
  });

  it("devuelve el error genérico para un usuario desconocido (e1)", async () => {
    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "no-existe", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message).toBe("Usuario o contraseña incorrectos");
    }
  });

  it("bloquea al 5.º fallo consecutivo (e1b)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });

    for (let index = 0; index < 4; index += 1) {
      await insertLoginAttempt(testDb!.db, {
        usuario: "12345678-9",
        exitoso: false,
        fechaHora: minutesAgo(4 - index),
        usuarioId: "12345678-9",
      });
    }

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "bad" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("FORBIDDEN");
      expect(response.error.message).toContain("bloqueada");
    }
  });

  it("rechaza el inicio de sesión mientras la cuenta ya está bloqueada (e2)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });

    for (let index = 0; index < 5; index += 1) {
      await insertLoginAttempt(testDb!.db, {
        usuario: "12345678-9",
        exitoso: false,
        fechaHora: minutesAgo(5 - index),
        usuarioId: "12345678-9",
      });
    }

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("FORBIDDEN");
      expect(response.error.message).toContain("bloqueada");
    }
  });

  it("rechaza la cuenta de un trabajador inactivo (e3)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      estado: "inactivo",
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("FORBIDDEN");
      expect(response.error.message).toBe("Usuario o contraseña incorrectos");
    }
  });

  it("exige cambio de contraseña ante una contraseña temporal válida", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      esTemporal: true,
      temporalExpiracion: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.passwordChangeRequired).toBe(true);
    }
  });

  it("rechaza una contraseña temporal vencida (RF58)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
      esTemporal: true,
      temporalExpiracion: new Date(NOW.getTime() - 3_600_000).toISOString(),
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "12345678-9", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("BUSINESS_RULE");
    }
  });

  it("coincide con el RUT almacenado ignorando el guion (entrada solo con dígitos)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "12345678-9",
      trabajadorId: 1,
      rut: "12345678-9",
    });

    const response = await authenticateWithExecutor(
      testDb!.db,
      schema,
      { usuario: "123456789", contrasena: "good" },
      makeDeps(true),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.usuarioId).toBe("12345678-9");
    }
  });
});
