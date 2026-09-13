import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createInventoryValuationController,
  loadAuthorizedInventoryValuation,
  queryInventoryValuationWithExecutor,
} from "../../../src/main/controllers/inventory-valuation";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";
import { guardChannel } from "../../../src/main/controllers/auth-guard";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";

const owner: AuthenticatedUser = {
  role: "dueno",
  usuarioId: "owner",
  usuarioRol: "dueno",
  trabajadorNombre: "Dueña Prueba",
};

describe("CU19 inventory valuation controller (C36)", () => {
  it.each(["dueno", "trabajador"] as const)(
    "authorizes and returns the valuation for %s",
    async (role) => {
      const result = { categorias: [], totalInventario: 0 };
      const load = vi.fn(async () => ({
        result,
        user: { ...owner, role },
      }));
      const controller = createInventoryValuationController({ load });

      const response = await controller.handle(
        { usuarioId: "trusted-user" },
        {
          channel: "inventario:valorizacion",
          claims: sessionClaims(role),
        },
      );

      expect(response).toEqual({ ok: true, data: result });
      expect(load).toHaveBeenCalledWith({ usuarioId: "trusted-user" }, role);
    },
  );

  it("rejects missing or invalid sessions and invalid channels", async () => {
    const controller = createInventoryValuationController({
      load: async () => {
        throw new AccessDeniedError("Sesión requerida");
      },
    });

    await expect(
      controller.handle({}, { channel: "inventario:valorizacion" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: "Sesión requerida" },
    });
    await expect(
      controller.handle({}, { channel: "inventario:otro" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });

  it("maps database failures and performs no audit or write operation", async () => {
    const authorize = vi.fn(async () => owner);
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const controller = createInventoryValuationController({
      load: (request, sessionRole) =>
        loadAuthorizedInventoryValuation(request, sessionRole, {
          authorize,
          query,
        }),
    });

    await expect(
      controller.handle(
        { usuarioId: "owner" },
        { channel: "inventario:valorizacion", claims: sessionClaims("dueno") },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR" },
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it("uses the JWT identity instead of an identity sent by the renderer", async () => {
    const result = await guardChannel(
      "inventario:valorizacion",
      { usuarioId: "spoofed", __authToken: "token" },
      {
        verifyToken: () => sessionClaims("trabajador"),
        audit: vi.fn(async () => undefined),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload as { usuarioId: string }).usuarioId).toBe(
        "trusted-user",
      );
    }
  });
});

describe("CU19 persistent inventory valuation query", () => {
  let client: Client;
  let tempDirectory: string;

  beforeAll(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), "huascar-valuation-"));
    client = createClient({ url: `file:${join(tempDirectory, "valuation.db")}` });
    await client.executeMultiple(`
      CREATE TABLE categoria (
        categoria_id INTEGER PRIMARY KEY,
        categoria_nombre TEXT NOT NULL
      );
      CREATE TABLE producto (
        producto_id INTEGER PRIMARY KEY,
        producto_nombre TEXT NOT NULL,
        producto_estado TEXT NOT NULL,
        categoria_id INTEGER NOT NULL
      );
      CREATE TABLE lote (
        lote_id TEXT PRIMARY KEY,
        lote_cantidad_actual INTEGER NOT NULL,
        lote_precio_costo INTEGER NOT NULL,
        producto_id INTEGER NOT NULL
      );
      CREATE TABLE lote_perecible (
        lote_id TEXT PRIMARY KEY,
        lote_perecible_fecha_vencimiento TEXT NOT NULL
      );
      CREATE TABLE log_auditoria (log_id INTEGER PRIMARY KEY);

      INSERT INTO categoria VALUES
        (1, 'Abarrotes'),
        (2, 'Bebidas'),
        (3, 'Categoría sin stock');
      INSERT INTO producto VALUES
        (1, 'Harina', 'activo', 1),
        (2, 'Arroz inactivo', 'inactivo', 1),
        (3, 'Agua costo cero', 'activo', 2),
        (4, 'Leche vencida', 'activo', 2),
        (5, 'Producto agotado', 'activo', 3);
      INSERT INTO lote VALUES
        ('harina-a', 2, 100, 1),
        ('harina-b', 3, 200, 1),
        ('arroz', 4, 50, 2),
        ('agua-cero', 5, 0, 3),
        ('leche-vencida', 2, 300, 4),
        ('agotado-costo-alto', 0, 9999, 5);
      INSERT INTO lote_perecible VALUES ('leche-vencida', '2020-01-01');
    `);
  });

  afterAll(async () => {
    client.close();
    await removeTempDirectory(tempDirectory);
  });

  it("aggregates positive stock by category without filtering product status, expiry or zero cost", async () => {
    const database = drizzle(client);
    const result = await queryInventoryValuationWithExecutor(database);

    expect(result).toEqual({
      categorias: [
        {
          categoriaId: 1,
          categoria: "Abarrotes",
          cantidadProductos: 2,
          stockTotal: 9,
          valorTotal: 1_000,
        },
        {
          categoriaId: 2,
          categoria: "Bebidas",
          cantidadProductos: 2,
          stockTotal: 7,
          valorTotal: 600,
        },
      ],
      totalInventario: 1_600,
    });

    const unchangedLots = await client.execute(
      "SELECT lote_id, lote_cantidad_actual FROM lote ORDER BY lote_id",
    );
    expect(unchangedLots.rows).toHaveLength(6);
    expect(
      unchangedLots.rows.find((row) => row.lote_id === "harina-a")
        ?.lote_cantidad_actual,
    ).toBe(2);
    const auditRows = await client.execute("SELECT COUNT(*) AS total FROM log_auditoria");
    expect(Number(auditRows.rows[0]?.total)).toBe(0);
  });

  it("returns an empty result and zero total when no lot has stock", async () => {
    const emptyDirectory = await mkdtemp(join(tmpdir(), "huascar-valuation-empty-"));
    const emptyClient = createClient({
      url: `file:${join(emptyDirectory, "empty.db")}`,
    });

    try {
      await emptyClient.executeMultiple(`
        CREATE TABLE categoria (
          categoria_id INTEGER PRIMARY KEY,
          categoria_nombre TEXT NOT NULL
        );
        CREATE TABLE producto (
          producto_id INTEGER PRIMARY KEY,
          categoria_id INTEGER NOT NULL
        );
        CREATE TABLE lote (
          lote_id TEXT PRIMARY KEY,
          lote_cantidad_actual INTEGER NOT NULL,
          lote_precio_costo INTEGER NOT NULL,
          producto_id INTEGER NOT NULL
        );
        INSERT INTO categoria VALUES (1, 'Vacía');
        INSERT INTO producto VALUES (1, 1);
        INSERT INTO lote VALUES ('agotado', 0, 100, 1);
      `);

      await expect(
        queryInventoryValuationWithExecutor(drizzle(emptyClient)),
      ).resolves.toEqual({ categorias: [], totalInventario: 0 });
    } finally {
      emptyClient.close();
      await removeTempDirectory(emptyDirectory);
    }
  });
});

function sessionClaims(role: "dueno" | "trabajador"): SessionTokenClaims {
  return {
    usuarioId: "trusted-user",
    rol: role,
    usuarioRol: role,
    passwordTemporal: false,
    sesionId: "00000000-0000-4000-8000-000000000019",
  };
}

async function removeTempDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
