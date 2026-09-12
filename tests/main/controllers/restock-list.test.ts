import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRestockListController,
  loadAuthorizedRestockList,
  queryRestockListWithExecutor,
} from "../../../src/main/controllers/restock-list";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";

const owner: AuthenticatedUser = {
  role: "dueno",
  usuarioId: "owner",
  usuarioRol: "dueno",
  trabajadorNombre: "Dueña Prueba",
};

describe("CU16 restock list controller (C32)", () => {
  it.each(["dueno", "trabajador"] as const)(
    "authorizes and returns the list for %s",
    async (role) => {
      const load = vi.fn(async () => ({ items: [], user: { ...owner, role } }));
      const controller = createRestockListController({ load });

      const response = await controller.handle(
        { usuarioId: "trusted-user" },
        { channel: "inventario:lista-reabastecimiento" },
      );

      expect(response).toEqual({ ok: true, data: [] });
      expect(load).toHaveBeenCalledWith(
        { usuarioId: "trusted-user" },
        undefined,
      );
    },
  );

  it("rejects unauthenticated access and invalid channels", async () => {
    const controller = createRestockListController({
      load: async () => {
        throw new AccessDeniedError("Sesión requerida");
      },
    });

    await expect(
      controller.handle({}, { channel: "inventario:lista-reabastecimiento" }),
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

  it("maps query failures without producing audit or write activity", async () => {
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const authorize = vi.fn(async () => owner);
    const controller = createRestockListController({
      load: (request, sessionRole) =>
        loadAuthorizedRestockList(request, sessionRole, { authorize, query }),
    });

    await expect(
      controller.handle(
        { usuarioId: "owner" },
        { channel: "inventario:lista-reabastecimiento" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR" },
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });
});

describe("CU16 persistent restock query", () => {
  let client: Client;
  let tempDirectory: string;

  beforeAll(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), "huascar-restock-"));
    client = createClient({ url: `file:${join(tempDirectory, "restock.db")}` });
    await client.executeMultiple(`
      CREATE TABLE categoria (
        categoria_id INTEGER PRIMARY KEY,
        categoria_nombre TEXT NOT NULL
      );
      CREATE TABLE producto (
        producto_id INTEGER PRIMARY KEY,
        producto_ean_13 TEXT NOT NULL,
        producto_nombre TEXT NOT NULL,
        producto_stock_minimo INTEGER NOT NULL,
        producto_estado TEXT NOT NULL,
        categoria_id INTEGER NOT NULL
      );
      CREATE TABLE lote (
        lote_id TEXT PRIMARY KEY,
        lote_cantidad_actual INTEGER NOT NULL,
        producto_id INTEGER NOT NULL
      );
      CREATE TABLE lote_perecible (
        lote_id TEXT PRIMARY KEY,
        lote_perecible_fecha_vencimiento TEXT NOT NULL
      );
      INSERT INTO categoria VALUES (1, 'Abarrotes');
      INSERT INTO producto VALUES
        (1, '7800000000001', 'Zapallo', 5, 'activo', 1),
        (2, '7800000000002', 'Ácido inactivo', 2, 'inactivo', 1),
        (3, '7800000000003', 'Sobre mínimo', 5, 'activo', 1),
        (4, '7800000000004', 'Mínimo cero', 0, 'activo', 1),
        (5, '7800000000005', 'Leche con lote vencido', 10, 'activo', 1);
      INSERT INTO lote VALUES
        ('lote-limite-a', 2, 1),
        ('lote-limite-b', 3, 1),
        ('lote-sobre', 6, 3),
        ('lote-vencido', 4, 5),
        ('lote-vigente', 5, 5);
      INSERT INTO lote_perecible VALUES
        ('lote-vencido', '2020-01-01'),
        ('lote-vigente', '2099-01-01');
    `);
  });

  afterAll(async () => {
    client.close();
    await removeTempDirectory(tempDirectory);
  });

  it("includes inactive and lotless products, all lots and the exact boundary", async () => {
    const database = drizzle(client);
    const items = await queryRestockListWithExecutor(database);

    expect(items.map((item) => item.ean13)).toEqual([
      "7800000000002",
      "7800000000004",
      "7800000000001",
      "7800000000005",
    ]);
    expect(items).toContainEqual({
      nombre: "Ácido inactivo",
      ean13: "7800000000002",
      categoria: "Abarrotes",
      stockActual: 0,
      stockMinimo: 2,
      cantidadSugerida: 4,
    });
    expect(items.find((item) => item.ean13 === "7800000000004")).toMatchObject({
      stockActual: 0,
      stockMinimo: 0,
      cantidadSugerida: 0,
    });
    expect(items.find((item) => item.ean13 === "7800000000001")).toMatchObject({
      stockActual: 5,
      stockMinimo: 5,
      cantidadSugerida: 5,
    });
    expect(items.find((item) => item.ean13 === "7800000000005")).toMatchObject({
      stockActual: 9,
      cantidadSugerida: 11,
    });
    expect(items.some((item) => item.ean13 === "7800000000003")).toBe(false);
  });
});

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
