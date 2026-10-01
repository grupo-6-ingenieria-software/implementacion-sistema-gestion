import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app } from "electron";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../src/main/controllers/auth-fixtures";
import { authorizeUser } from "../../src/main/controllers/auth-context";
import {
  auditInventoryExportWithExecutor,
  createInventoryExportController,
  type InventoryExportDependencies,
} from "../../src/main/controllers/inventory-export";
import { queryInventoryExportWithExecutor } from "../../src/main/controllers/inventory-export-query";
import {
  createInventoryPdfBuffer,
  createInventoryXlsxBuffer,
  saveInventoryFile,
} from "../../src/main/controllers/inventory-export-file";
import {
  INVENTORY_EXPORT_CHANNEL,
  INVENTORY_AUDIT_WARNING,
} from "../../src/shared/inventory-export";
import { seedInventoryExport } from "./controllers/inventory-export-fixture";

// Electron real y BD temporal. El diálogo se inyecta para no abrir ventanas interactivas.
const output = resolve("out/cu20-qa");
mkdirSync(join(output, "electron-user-data"), { recursive: true });
app.setPath("userData", join(output, "electron-user-data"));
if (!app.isReady()) app.disableHardwareAcceleration();
let fixture: AuthTestDatabase | undefined;
let exitCode = 0;
try {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  fixture = await createAuthTestDatabase();
  const database = fixture;
  await seedInventoryExport(database);
  for (const [index, role] of (["dueno", "trabajador"] as const).entries()) {
    await seedUser(database.db, {
      usuarioId: role,
      trabajadorId: index + 1,
      rut: index ? "22222222-2" : "11111111-1",
      rolBd: role,
      nombre: role === "dueno" ? "María" : "Camila",
      apellido: "Huáscar",
    });
  }
  for (let index = 3; index <= 122; index++) {
    await database.db.insert(schema.producto).values({
      productoId: index,
      productoEan13: String(index).padStart(13, "0"),
      productoNombre: `Producto ${String(index).padStart(3, "0")} con nombre largo y caracteres españoles: áéíóú ñ`,
      productoPrecioVenta: 9999,
      productoStockMinimo: index,
      productoEstado: index % 2 ? "activo" : "inactivo",
      categoriaId: 1,
    });
    await database.db.insert(schema.historialPrecioProducto).values({
      productoId: index,
      historialPrecioCosto: index * 10,
      historialPrecioVenta: index * 20,
    });
  }
  const inventoryBefore = await Promise.all([
    database.db.select().from(schema.producto),
    database.db.select().from(schema.lote),
    database.db.select().from(schema.historialPrecioProducto),
  ]);
  const dependencies = (path: string): InventoryExportDependencies => ({
    authorize: (id, role) =>
      authorizeUser(database.db, schema, id, ["dueno", "trabajador"], role),
    query: () => queryInventoryExportWithExecutor(database.db),
    showSaveDialog: async () => ({ canceled: false, filePath: path }),
    confirmDestination: async () => true,
    createPdf: createInventoryPdfBuffer,
    createXlsx: createInventoryXlsxBuffer,
    save: saveInventoryFile,
    audit: (id, format, count) =>
      auditInventoryExportWithExecutor(database.db, id, format, count),
    now: () => new Date("2026-09-12T23:30:00Z"),
    documentsPath: () => output,
    logError: () => undefined,
  });
  const context = (role: "dueno" | "trabajador") => ({
    channel: INVENTORY_EXPORT_CHANNEL,
    claims: {
      usuarioId: role,
      rol: role,
      usuarioRol: role,
      passwordTemporal: false,
      sesionId: "test-session",
    },
  });
  const files: string[] = [];
  for (const role of ["dueno", "trabajador"] as const) {
    for (const formato of ["pdf", "xlsx"] as const) {
      const path = join(output, `${role}.${formato}`);
      const response = await createInventoryExportController(
        dependencies(path),
      ).handle({ formato }, context(role));
      if (!response.ok) throw new Error(response.error.message);
      assert.equal(response.data.estado, "saved");
      assert.equal(response.data.cantidadFilas, 122);
      const contents = await readFile(path);
      assert.equal(
        contents.subarray(0, formato === "pdf" ? 4 : 2).toString(),
        formato === "pdf" ? "%PDF" : "PK",
      );
      if (formato === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(contents as unknown as ExcelJS.Buffer);
        assert.equal(workbook.getWorksheet("Inventario")!.rowCount, 128);
        assert.equal(
          workbook.getWorksheet("Inventario")!.getCell("A7").value,
          "0000000000001",
        );
        assert.equal(
          workbook.getWorksheet("Inventario")!.getCell("F7").value,
          80,
        );
      }
      files.push(path);
    }
  }
  assert.equal(
    (await database.db.select().from(schema.logAuditoria)).length,
    4,
  );
  assert.deepEqual(
    await Promise.all([
      database.db.select().from(schema.producto),
      database.db.select().from(schema.lote),
      database.db.select().from(schema.historialPrecioProducto),
    ]),
    inventoryBefore,
  );

  const cancelled = dependencies(join(output, "cancelled.xlsx"));
  cancelled.showSaveDialog = async () => ({ canceled: true });
  cancelled.createXlsx = async () => {
    throw new Error("Unexpected generation after cancel");
  };
  const cancelResult = await createInventoryExportController(cancelled).handle(
    { formato: "xlsx" },
    context("trabajador"),
  );
  assert.equal(cancelResult.ok && cancelResult.data.estado, "cancelled");

  await database.db.run(
    sql`CREATE TRIGGER fail_audit BEFORE INSERT ON log_auditoria BEGIN SELECT RAISE(ABORT, 'audit test'); END`,
  );
  const warningPath = join(output, "audit-warning.xlsx");
  const warning = await createInventoryExportController(
    dependencies(warningPath),
  ).handle({ formato: "xlsx" }, context("trabajador"));
  assert.equal(
    warning.ok && warning.data.estado === "saved" && warning.data.auditoria,
    "fallida",
  );
  assert.equal(
    warning.ok &&
      warning.data.estado === "saved" &&
      warning.data.auditoria === "fallida" &&
      warning.data.advertencia,
    INVENTORY_AUDIT_WARNING,
  );
  assert.equal((await readFile(warningPath)).subarray(0, 2).toString(), "PK");

  await database.db.run(
    sql`DELETE FROM historial_precio_producto WHERE producto_id = 2`,
  );
  const invalid = await createInventoryExportController(
    dependencies(join(output, "invalid.pdf")),
  ).handle({ formato: "pdf" }, context("dueno"));
  assert.equal(
    !invalid.ok && invalid.error.message,
    "No fue posible generar el archivo",
  );

  await database.db.delete(schema.lotePerecible);
  await database.db.delete(schema.lote);
  await database.db.delete(schema.historialPrecioProducto);
  await database.db.delete(schema.producto);
  const empty = dependencies(join(output, "empty.pdf"));
  empty.showSaveDialog = async () => {
    throw new Error("Unexpected dialog for E1");
  };
  for (const role of ["dueno", "trabajador"] as const) {
    const response = await createInventoryExportController(empty).handle(
      { formato: "pdf" },
      context(role),
    );
    assert.equal(
      !response.ok && response.error.message,
      "No hay productos para exportar",
    );
  }
  assert.equal(
    (await database.db.select().from(schema.logAuditoria)).length,
    4,
  );
  await writeFile(
    join(output, "electron-result.json"),
    JSON.stringify(
      {
        ok: true,
        rows: 122,
        files,
        roles: ["dueno", "trabajador"],
        verified: [
          "PDF real",
          "Excel real",
          "E1",
          "E2 precios",
          "cancelación",
          "auditoría",
          "inventario sin cambios",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  exitCode = 1;
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "electron-result.json"),
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack : String(error),
    }),
  );
} finally {
  fixture?.client.close();
  if (fixture) await removeAuthTempDir(fixture.dir);
  app.exit(exitCode);
}
