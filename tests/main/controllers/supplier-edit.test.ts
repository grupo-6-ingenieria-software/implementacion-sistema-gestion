import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { guardChannel } from "../../../src/main/controllers/auth-guard";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import {
  createSupplierEditController,
  editSupplierWithExecutor,
  SupplierEditError,
  SupplierNotFoundError,
} from "../../../src/main/controllers/supplier-edit";
import {
  createSupplierQueryController,
  findSupplierWithExecutor,
  listSuppliersWithExecutor,
} from "../../../src/main/controllers/supplier-query";
import type { SupplierEditPayload } from "../../../src/shared/suppliers";

const validEdit: SupplierEditPayload = {
  rut: "12345678-5",
  nombreRazonSocial: "Nueva Distribuidora Sur",
  nombreContacto: "Camila Soto",
  telefono: "987654321",
  correoElectronico: "nuevo@sur.cl",
  categoriaIds: [2],
  usuarioId: "11111111-1",
};

describe("CU14 supplier controllers", () => {
  it("serves list, detail and edit through their documented channels", async () => {
    const listSuppliers = vi.fn(async () => ({
      suppliers: [
        {
          proveedorId: 1,
          rut: "12345678-5",
          nombreRazonSocial: "Sur",
          nombreContacto: "Ana",
          telefono: "912345678",
          correoElectronico: "ana@sur.cl",
          categorias: [{ id: 1, nombre: "Abarrotes" }],
        },
      ],
      categories: [{ id: 1, nombre: "Abarrotes" }],
    }));
    const detail = {
      proveedorId: 1,
      rut: "12345678-5",
      nombreRazonSocial: "Sur",
      nombreContacto: "Ana",
      telefono: "912345678",
      correoElectronico: "ana@sur.cl",
      categoriaIds: [1],
    };
    const query = createSupplierQueryController({
      listSuppliers,
      findSupplier: async () => detail,
    });
    const editSupplier = vi.fn(async () => ({
      proveedorId: 1,
      rut: "12.345.678-5",
    }));
    const edit = createSupplierEditController({ editSupplier });

    await expect(
      query.handle(
        { busqueda: " sur ", usuarioId: " user " },
        { channel: "proveedor:listar" },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(listSuppliers).toHaveBeenCalledWith({
      busqueda: "sur",
      usuarioId: "user",
    });
    await expect(
      query.handle(
        { rut: "12.345.678-5", usuarioId: "user" },
        { channel: "proveedor:buscar-existente" },
      ),
    ).resolves.toEqual({ ok: true, data: detail });
    await expect(
      edit.handle(validEdit, { channel: "proveedor:editar" }),
    ).resolves.toEqual({
      ok: true,
      data: { proveedorId: 1, rut: "12.345.678-5" },
    });
    expect(editSupplier).toHaveBeenCalledWith(validEdit);
  });

  it("normalizes validation, not-found, authorization and database errors", async () => {
    const query = createSupplierQueryController({
      listSuppliers: async () => {
        throw new AccessDeniedError();
      },
      findSupplier: async () => null,
    });
    const invalidLookup = await query.handle(
      { rut: "invalid" },
      { channel: "proveedor:buscar-existente" },
    );
    expect(invalidLookup).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", fieldErrors: { rut: expect.any(String) } },
    });
    await expect(
      query.handle(
        { rut: "12345678-5" },
        { channel: "proveedor:buscar-existente" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(
      query.handle({}, { channel: "proveedor:listar" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    for (const error of [
      new AccessDeniedError(),
      new SupplierNotFoundError(),
      new SupplierEditError("invalid-categories", "Categoría inválida", {
        categoriaIds: "Categoría inválida",
      }),
      new Error("database unavailable"),
    ]) {
      const edit = createSupplierEditController({
        editSupplier: async () => {
          throw error;
        },
      });
      const response = await edit.handle(validEdit, {
        channel: "proveedor:editar",
      });
      const expectedCode =
        error instanceof AccessDeniedError
          ? "FORBIDDEN"
          : error instanceof SupplierNotFoundError
            ? "NOT_FOUND"
            : error instanceof SupplierEditError
              ? "VALIDATION_ERROR"
              : "DATABASE_ERROR";
      expect(response).toMatchObject({
        ok: false,
        error: { code: expectedCode },
      });
    }

    const persistence = vi.fn(async () => ({ proveedorId: 1, rut: "x" }));
    const invalidEdit = createSupplierEditController({
      editSupplier: persistence,
    });
    await expect(
      invalidEdit.handle({}, { channel: "proveedor:editar" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(persistence).not.toHaveBeenCalled();
    await expect(
      invalidEdit.handle({}, { channel: "otro" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
    await expect(
      query.handle({}, { channel: "otro" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });
});

describe("CU14 protected channels", () => {
  it.each(["dueno", "trabajador"] as const)(
    "allows role %s on query and edit channels",
    async (rol) => {
      for (const channel of [
        "proveedor:listar",
        "proveedor:buscar-existente",
        "proveedor:editar",
      ]) {
        const result = await guardChannel(
          channel,
          { __authToken: "valid", usuarioId: "spoofed" },
          { verifyToken: () => claimsFor(rol), audit: async () => undefined },
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

  it("rejects CU14 without a session", async () => {
    const result = await guardChannel(
      "proveedor:editar",
      {},
      { verifyToken: () => null, audit: async () => undefined },
    );
    expect(result).toMatchObject({
      ok: false,
      response: { error: { code: "FORBIDDEN" } },
    });
  });
});

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
let testDb: TestDatabase | undefined;

describe("CU14 transactional persistence", () => {
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

  it("loads detail and searches case-insensitive names and formatted RUTs", async () => {
    const detail = await testDb!.db.transaction((tx) =>
      findSupplierWithExecutor(tx, schema, {
        rut: "12345678-5",
        usuarioId: "11111111-1",
      }),
    );
    expect(detail).toEqual({
      proveedorId: 1,
      rut: "12.345.678-5",
      nombreRazonSocial: "Distribuidora Álamo",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "ventas@alamo.cl",
      categoriaIds: [1],
    });

    const byName = await list({ busqueda: "distribuidora ALAMO" });
    const byRut = await list({ busqueda: "12 345 678 5" });
    expect(byName.suppliers.map(({ proveedorId }) => proveedorId)).toEqual([1]);
    expect(byRut.suppliers.map(({ proveedorId }) => proveedorId)).toEqual([1]);
  });

  it("updates every editable field, replaces categories and preserves stored RUT", async () => {
    const result = await edit(validEdit);
    expect(result).toEqual({ proveedorId: 1, rut: "12.345.678-5" });

    const [snapshot] = await testDb!.db.all<{
      rut: string;
      nombreRazonSocial: string;
      nombreContacto: string;
      telefono: string;
      correoElectronico: string;
      categories: string;
      auditDescription: string;
      auditType: string;
      auditUserId: string;
    }>(sql`
      SELECT p.proveedor_rut AS rut,
        p.proveedor_nombre_razon_social AS nombreRazonSocial,
        p.proveedor_nombre_contacto AS nombreContacto,
        p.proveedor_telefono AS telefono,
        p.proveedor_correo_electronico AS correoElectronico,
        (SELECT group_concat(pc.categoria_id, ',') FROM proveedor_categoria pc
          WHERE pc.proveedor_id = p.proveedor_id) AS categories,
        la.log_tipo_accion AS auditType,
        la.log_descripcion AS auditDescription,
        uv.usuario_id AS auditUserId
      FROM proveedor p
      JOIN log_auditoria la ON la.log_tipo_accion = 'edicion_proveedor'
      JOIN usuario_version uv ON uv.usuario_version_id = la.usuario_version_id
      WHERE p.proveedor_id = 1
    `);
    expect(snapshot).toMatchObject({
      rut: "12.345.678-5",
      nombreRazonSocial: validEdit.nombreRazonSocial,
      nombreContacto: validEdit.nombreContacto,
      telefono: validEdit.telefono,
      correoElectronico: validEdit.correoElectronico,
      categories: "2",
      auditType: "edicion_proveedor",
      auditUserId: "11111111-1",
    });
    expect(snapshot.auditDescription).toContain("razón social");
    expect(snapshot.auditDescription).toContain("categorías");
    expect(snapshot.auditDescription).toContain("responsable 11111111-1");
    expect(snapshot.auditDescription).not.toContain(validEdit.nombreContacto);
    expect(snapshot.auditDescription).not.toContain(validEdit.telefono);
    expect(snapshot.auditDescription).not.toContain(validEdit.correoElectronico);
  });

  it("allows a worker and audits a valid save without effective changes", async () => {
    const result = await edit({
      rut: "12.345.678-5",
      nombreRazonSocial: "Distribuidora Álamo",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "ventas@alamo.cl",
      categoriaIds: [1],
      usuarioId: "12345670-K",
    });
    expect(result.rut).toBe("12.345.678-5");
    const descriptions = await testDb!.db.all<{ description: string }>(sql`
      SELECT log_descripcion AS description FROM log_auditoria
      WHERE log_tipo_accion = 'edicion_proveedor'
    `);
    expect(descriptions[0].description).toContain("sin cambios efectivos");
    expect(descriptions[0].description).toContain("12345670-K");
  });

  it("rejects missing suppliers and categories without partial writes", async () => {
    const before = await databaseSnapshot();
    await expect(
      edit({ ...validEdit, rut: "11111111-1" }),
    ).rejects.toBeInstanceOf(SupplierNotFoundError);
    expect(await databaseSnapshot()).toEqual(before);

    await expect(
      edit({ ...validEdit, categoriaIds: [2, 99] }),
    ).rejects.toMatchObject({ reason: "invalid-categories" });
    expect(await databaseSnapshot()).toEqual(before);
  });

  it.each([
    [
      "categories",
      `CREATE TRIGGER fail_supplier_category_edit
       BEFORE INSERT ON proveedor_categoria
       BEGIN SELECT RAISE(ABORT, 'controlled category failure'); END;`,
    ],
    [
      "audit",
      `CREATE TRIGGER fail_supplier_audit_edit
       BEFORE INSERT ON log_auditoria
       WHEN NEW.log_tipo_accion = 'edicion_proveedor'
       BEGIN SELECT RAISE(ABORT, 'controlled audit failure'); END;`,
    ],
  ])("rolls back the full edit after a late %s failure", async (_stage, trigger) => {
    const before = await databaseSnapshot();
    await testDb!.client.executeMultiple(trigger);
    await expect(edit(validEdit)).rejects.toThrow();
    expect(await databaseSnapshot()).toEqual(before);
  });
});

function claimsFor(rol: "dueno" | "trabajador"): SessionTokenClaims {
  return {
    usuarioId: "trusted-user",
    rol,
    usuarioRol: rol,
    passwordTemporal: false,
    sesionId: "00000000-0000-4000-8000-000000000777",
  };
}

function edit(payload: SupplierEditPayload) {
  return testDb!.db.transaction((tx) =>
    editSupplierWithExecutor(tx, schema, payload),
  );
}

function list(request: { busqueda?: string }) {
  return testDb!.db.transaction((tx) =>
    listSuppliersWithExecutor(tx, schema, {
      ...request,
      usuarioId: "11111111-1",
    }),
  );
}

async function databaseSnapshot() {
  return testDb!.db.all(sql`
    SELECT 'proveedor' AS source, proveedor_id AS id,
      proveedor_rut || '|' || proveedor_nombre_razon_social || '|' ||
      proveedor_nombre_contacto || '|' || proveedor_telefono || '|' ||
      proveedor_correo_electronico AS value
    FROM proveedor
    UNION ALL
    SELECT 'categoria', proveedor_id, CAST(categoria_id AS TEXT)
    FROM proveedor_categoria
    UNION ALL
    SELECT 'auditoria', 0, log_tipo_accion || '|' || log_descripcion
    FROM log_auditoria
    UNION ALL
    SELECT 'version', 0, usuario_id FROM usuario_version
    ORDER BY source, id, value
  `);
}

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "huascar-supplier-edit-"));
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
    VALUES (1, 'Lácteos', 1), (2, 'Abarrotes', 0)
  `);
  await db.run(sql`
    INSERT INTO proveedor
      (proveedor_id, proveedor_rut, proveedor_nombre_razon_social,
       proveedor_nombre_contacto, proveedor_telefono,
       proveedor_correo_electronico)
    VALUES
      (1, '12.345.678-5', 'Distribuidora Álamo', 'Ana Pérez', '912345678',
       'ventas@alamo.cl'),
      (2, '12345670-K', 'COMERCIAL NORTE', 'Luis Díaz', '923456789',
       'contacto@norte.cl')
  `);
  await db.run(sql`
    INSERT INTO proveedor_categoria
      (proveedor_categoria_id, proveedor_id, categoria_id)
    VALUES
      ('00000000-0000-4000-8000-000000000101', 1, 1),
      ('00000000-0000-4000-8000-000000000102', 2, 2)
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
