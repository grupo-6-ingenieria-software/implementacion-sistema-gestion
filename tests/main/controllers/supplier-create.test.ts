import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  createSupplierCreateController,
  isSupplierRutUniqueConstraintError,
  listSupplierCategoriesWithExecutor,
  registerSupplierWithExecutor,
  SupplierRegistrationError,
} from "../../../src/main/controllers/supplier-create";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { guardChannel } from "../../../src/main/controllers/auth-guard";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import type { SupplierRegistrationPayload } from "../../../src/shared/suppliers";

const validPayload: SupplierRegistrationPayload = {
  rut: "12345678-5",
  nombreRazonSocial: "Distribuidora del Sur",
  nombreContacto: "Ana Pérez",
  telefono: "912345678",
  correoElectronico: "ventas@sur.cl",
  categoriaIds: [1, 2],
  usuarioId: "11111111-1",
};

describe("RegistrarProveedorHandler", () => {
  it("atiende las categorías y el registro a través de sus dos canales", async () => {
    const registerSupplier = vi.fn(async () => ({
      proveedorId: 8,
      rut: "12345678-5",
    }));
    const controller = createSupplierCreateController({
      listCategories: async () => [{ id: 1, nombre: "Abarrotes" }],
      registerSupplier,
    });

    const categories = await controller.handle(
      { usuarioId: "11111111-1" },
      { channel: "proveedor:categorias" },
    );
    const registration = await controller.handle(validPayload, {
      channel: "proveedor:registrar",
    });

    expect(categories).toEqual({
      ok: true,
      data: [{ id: 1, nombre: "Abarrotes" }],
    });
    expect(registration).toEqual({
      ok: true,
      data: { proveedorId: 8, rut: "12345678-5" },
    });
    expect(registerSupplier).toHaveBeenCalledWith(validPayload);
  });

  it("devuelve errores de campo sin invocar la persistencia", async () => {
    const registerSupplier = vi.fn(async () => ({
      proveedorId: 1,
      rut: "12345678-5",
    }));
    const controller = createSupplierCreateController({
      listCategories: async () => [],
      registerSupplier,
    });
    const response = await controller.handle({}, {
      channel: "proveedor:registrar",
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.fieldErrors).toHaveProperty("rut");
      expect(response.error.fieldErrors).toHaveProperty("categoriaIds");
    }
    expect(registerSupplier).not.toHaveBeenCalled();
  });

  it("asigna categorías inválidas y RUT duplicado a campos de validación", async () => {
    for (const domainError of [
      new SupplierRegistrationError(
        "invalid-categories",
        "Categoría inexistente",
        { categoriaIds: "Seleccione únicamente categorías disponibles." },
      ),
      new SupplierRegistrationError("duplicate-rut", "Duplicado", {
        rut: "El proveedor ya existe.",
      }),
    ]) {
      const controller = createSupplierCreateController({
        listCategories: async () => [],
        registerSupplier: async () => {
          throw domainError;
        },
      });
      const response = await controller.handle(validPayload, {
        channel: "proveedor:registrar",
      });
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("asigna errores de autorización, persistencia y canales desconocidos", async () => {
    const forbidden = createSupplierCreateController({
      listCategories: async () => {
        throw new AccessDeniedError();
      },
      registerSupplier: async () => validResult(),
    });
    const databaseFailure = createSupplierCreateController({
      listCategories: async () => [],
      registerSupplier: async () => {
        throw new Error("database unavailable");
      },
    });

    const forbiddenResponse = await forbidden.handle(
      { usuarioId: "x" },
      { channel: "proveedor:categorias" },
    );
    const databaseResponse = await databaseFailure.handle(validPayload, {
      channel: "proveedor:registrar",
    });
    const unknownResponse = await forbidden.handle(
      {},
      { channel: "proveedor:editar" },
    );

    expect(forbiddenResponse).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(databaseResponse).toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR" },
    });
    expect(unknownResponse).toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });

  it("reconoce la restricción única de RUT de proveedor en SQLite", () => {
    expect(
      isSupplierRutUniqueConstraintError(
        new Error("SQLITE_CONSTRAINT_UNIQUE: proveedor.proveedor_rut"),
      ),
    ).toBe(true);
  });
});

describe("canales protegidos de CU13", () => {
  it.each(["dueno", "trabajador"] as const)(
    "permite el rol %s en ambos canales de proveedor",
    async (rol) => {
      for (const channel of ["proveedor:categorias", "proveedor:registrar"]) {
        const result = await guardChannel(
          channel,
          { usuarioId: "spoofed", __authToken: "valid" },
          {
            verifyToken: () => claimsFor(rol),
            audit: async () => undefined,
          },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect((result.payload as { usuarioId: string }).usuarioId).toBe(
            "trusted-user",
          );
        }
      }
    },
  );

  it("rechaza una sesión ausente", async () => {
    const result = await guardChannel(
      "proveedor:registrar",
      {},
      { verifyToken: () => null, audit: async () => undefined },
    );
    expect(result).toMatchObject({
      ok: false,
      response: { ok: false, error: { code: "FORBIDDEN" } },
    });
  });
});

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
let testDb: TestDatabase | undefined;

describe("persistencia transaccional de CU13", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await seedFixture(testDb.db);
  });

  afterEach(async () => {
    if (!testDb) return;
    testDb.client.close();
    await removeTempDir(testDb.dir);
    testDb = undefined;
  });

  it.each(["11111111-1", "12345670-K"])(
    "permite que una cuenta activa %s registre un proveedor",
    async (usuarioId) => {
      const result = await register({ ...validPayload, usuarioId });
      expect(result).toEqual({ proveedorId: 1, rut: "12345678-5" });

      const snapshot = await testDb!.db.all<{
        auditDescription: string;
        auditModule: string;
        auditType: string;
        categoryCount: number;
        rut: string;
        userVersionCount: number;
      }>(sql`
        SELECT
          p.proveedor_rut AS rut,
          (SELECT COUNT(*) FROM proveedor_categoria pc
            WHERE pc.proveedor_id = p.proveedor_id) AS categoryCount,
          (SELECT COUNT(*) FROM usuario_version uv) AS userVersionCount,
          la.log_tipo_accion AS auditType,
          la.log_modulo AS auditModule,
          la.log_descripcion AS auditDescription
        FROM proveedor p
        INNER JOIN log_auditoria la
          ON la.log_tipo_accion = 'registro_proveedor'
      `);
      expect(snapshot[0]).toMatchObject({
        rut: "12345678-5",
        categoryCount: 2,
        userVersionCount: 1,
        auditType: "registro_proveedor",
        auditModule: "proveedores",
      });
      expect(snapshot[0].auditDescription).toContain("12345678-5");
      expect(snapshot[0].auditDescription).toContain("2 categoría(s)");
    },
  );

  it("lista las categorías en orden alfabético tras la autorización", async () => {
    const categories = await testDb!.db.transaction((tx) =>
      listSupplierCategoriesWithExecutor(tx, schema, "12345670-K"),
    );
    expect(categories).toEqual([
      { id: 2, nombre: "Abarrotes" },
      { id: 1, nombre: "Lácteos" },
    ]);
  });

  it("rechaza un RUT legado equivalente sin información parcial", async () => {
    await testDb!.db.run(sql`
      INSERT INTO proveedor
        (proveedor_rut, proveedor_nombre_razon_social,
         proveedor_nombre_contacto, proveedor_telefono,
         proveedor_correo_electronico)
      VALUES
        ('12.345.678-5', 'Proveedor legado', 'Contacto', '912345678',
         'legado@proveedor.cl')
    `);

    await expect(register(validPayload)).rejects.toMatchObject({
      reason: "duplicate-rut",
      fieldErrors: { rut: "El proveedor ya existe." },
    });
    expect(await count("proveedor")).toBe(1);
    expect(await count("proveedor_categoria")).toBe(0);
    expect(await count("log_auditoria")).toBe(0);
  });

  it("rechaza categorías inexistentes sin escribir un proveedor", async () => {
    await expect(
      register({ ...validPayload, categoriaIds: [1, 99] }),
    ).rejects.toMatchObject({ reason: "invalid-categories" });
    await expectNoSupplierWrite();
  });

  it.each([
    [
      "proveedor_categoria",
      `CREATE TRIGGER fail_supplier_category
       BEFORE INSERT ON proveedor_categoria
       BEGIN SELECT RAISE(ABORT, 'controlled category failure'); END;`,
    ],
    [
      "auditoria",
      `CREATE TRIGGER fail_supplier_audit
       BEFORE INSERT ON log_auditoria
       WHEN NEW.log_tipo_accion = 'registro_proveedor'
       BEGIN SELECT RAISE(ABORT, 'controlled audit failure'); END;`,
    ],
  ])("revierte todo ante un fallo tardío en %s", async (_stage, trigger) => {
    await testDb!.client.executeMultiple(trigger);
    await expect(register(validPayload)).rejects.toThrow();
    await expectNoSupplierWrite();
    expect(await count("usuario_version")).toBe(0);
  });
});

function validResult() {
  return { proveedorId: 1, rut: "12345678-5" };
}

function claimsFor(rol: "dueno" | "trabajador"): SessionTokenClaims {
  return {
    usuarioId: "trusted-user",
    rol,
    usuarioRol: rol,
    passwordTemporal: false,
    sesionId: "00000000-0000-4000-8000-000000000777",
  };
}

function register(payload: SupplierRegistrationPayload) {
  return testDb!.db.transaction((tx) =>
    registerSupplierWithExecutor(tx, schema, payload),
  );
}

async function expectNoSupplierWrite(): Promise<void> {
  expect(await count("proveedor")).toBe(0);
  expect(await count("proveedor_categoria")).toBe(0);
  expect(await count("log_auditoria")).toBe(0);
}

async function count(
  table:
    | "proveedor"
    | "proveedor_categoria"
    | "log_auditoria"
    | "usuario_version",
): Promise<number> {
  const rows = await testDb!.db.all<{ total: number }>(
    sql.raw(`SELECT COUNT(*) AS total FROM ${table}`),
  );
  return Number(rows[0]?.total ?? 0);
}

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-supplier-create-"));
  const client = createClient({
    url: `file:${join(dir, "test.db").replace(/\\/g, "/")}`,
  });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  const migrationsDir = join(process.cwd(), "drizzle/migrations");
  for (const file of (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await client.executeMultiple(
      await readFile(join(migrationsDir, file), "utf8"),
    );
  }
  return { client, db, dir };
}

async function seedFixture(db: TestDatabase["db"]): Promise<void> {
  await db.run(sql`
    INSERT INTO trabajador
      (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
       trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
    VALUES
      (1, '11111111-1', 'María', 'Dueña', '987654321', '2024-01-01', 'activo'),
      (2, '12345670-K', 'Pedro', 'Trabajador', '912345678', '2024-02-01', 'activo')
  `);
  await db.run(sql`
    INSERT INTO usuario
      (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
    VALUES
      ('11111111-1', 'dueno', '2026-01-01T00:00:00.000Z', 1),
      ('12345670-K', 'trabajador', '2026-01-01T00:00:00.000Z', 2)
  `);
  await db.run(sql`
    INSERT INTO categoria
      (categoria_id, categoria_nombre, categoria_exige_vencimiento)
    VALUES
      (1, 'Lácteos', 1),
      (2, 'Abarrotes', 0)
  `);
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
