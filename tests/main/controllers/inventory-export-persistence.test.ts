import { sql } from "drizzle-orm";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import { authorizeUser } from "../../../src/main/controllers/auth-context";
import {
  auditInventoryExportWithExecutor,
  createInventoryExportController,
  type InventoryExportDependencies,
} from "../../../src/main/controllers/inventory-export";
import { queryInventoryExportWithExecutor } from "../../../src/main/controllers/inventory-export-query";
import {
  createInventoryXlsxBuffer,
  saveInventoryFile,
} from "../../../src/main/controllers/inventory-export-file";
import { INVENTORY_EXPORT_CHANNEL } from "../../../src/shared/inventory-export";
import { seedInventoryExport } from "./inventory-export-fixture";

let fixture: AuthTestDatabase;
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  await seedInventoryExport(fixture);
  await seedUser(fixture.db, {
    usuarioId: "11111111-1",
    trabajadorId: 1,
    rut: "11111111-1",
    nombre: "Camila",
    apellido: "Rojas",
    rolBd: "trabajador",
  });
});
afterEach(async () => {
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

async function inventorySnapshot() {
  return Promise.all([
    fixture.db.select().from(schema.producto),
    fixture.db.select().from(schema.lote),
    fixture.db.select().from(schema.categoria),
    fixture.db.select().from(schema.historialPrecioProducto),
  ]);
}
function dependencies(path: string): InventoryExportDependencies {
  return {
    authorize: (id, role) =>
      authorizeUser(fixture.db, schema, id, ["dueno", "trabajador"], role),
    query: () => queryInventoryExportWithExecutor(fixture.db),
    showSaveDialog: async () => ({ canceled: false, filePath: path }),
    confirmDestination: async () => true,
    createXlsx: createInventoryXlsxBuffer,
    createPdf: async () => {
      throw new Error("Unexpected PDF");
    },
    save: saveInventoryFile,
    audit: (id, format, count) =>
      auditInventoryExportWithExecutor(fixture.db, id, format, count),
    now: () => new Date("2026-09-12T23:30:00Z"),
    documentsPath: () => fixture.dir,
    logError: vi.fn(),
  };
}
const context = {
  channel: INVENTORY_EXPORT_CHANNEL,
  claims: {
    usuarioId: "11111111-1",
    rol: "trabajador" as const,
    usuarioRol: "trabajador",
    passwordTemporal: false,
    sesionId: "session",
  },
};

describe("CU20 real persistence and audit transaction (T10/T12)", () => {
  it("saves a real workbook then audits the canonical identity without changing inventory", async () => {
    const before = await inventorySnapshot();
    const path = join(fixture.dir, "inventory.xlsx");
    const controller = createInventoryExportController(dependencies(path));
    expect(
      await controller.handle(
        { formato: "xlsx", usuarioId: "attacker" },
        context,
      ),
    ).toMatchObject({
      ok: true,
      data: { estado: "saved", auditoria: "registrada", cantidadFilas: 2 },
    });
    expect((await readFile(path)).subarray(0, 2).toString()).toBe("PK");
    const logs = await fixture.db.select().from(schema.logAuditoria);
    const versions = await fixture.db.select().from(schema.usuarioVersion);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      logTipoAccion: "exportacion",
      logModulo: "inventario",
      usuarioVersionId: versions[0].usuarioVersionId,
    });
    expect(versions[0]).toMatchObject({
      usuarioId: "11111111-1",
      usuarioVersionNombre: "Camila Rojas",
      usuarioVersionRol: "trabajador",
    });
    await controller.handle({ formato: "xlsx" }, context);
    expect(await fixture.db.select().from(schema.usuarioVersion)).toHaveLength(
      1,
    );
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(2);
    expect(await inventorySnapshot()).toEqual(before);
  });
  it("rolls back the newly created user version if audit insertion fails, keeping the saved file", async () => {
    const before = await inventorySnapshot();
    await fixture.db.run(
      sql`CREATE TRIGGER fail_audit BEFORE INSERT ON log_auditoria BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`,
    );
    const path = join(fixture.dir, "inventory.xlsx");
    const deps = dependencies(path);
    expect(
      await createInventoryExportController(deps).handle(
        { formato: "xlsx" },
        context,
      ),
    ).toMatchObject({
      ok: true,
      data: { estado: "saved", auditoria: "fallida" },
    });
    expect((await readFile(path)).subarray(0, 2).toString()).toBe("PK");
    expect(await fixture.db.select().from(schema.usuarioVersion)).toEqual([]);
    expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([]);
    expect(deps.logError).toHaveBeenCalledWith("auditoria", expect.anything());
    expect(await inventorySnapshot()).toEqual(before);
    expect(
      (await readdir(fixture.dir)).some((file) => file.endsWith(".tmp")),
    ).toBe(false);
  });
});
