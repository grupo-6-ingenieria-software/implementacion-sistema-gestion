import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app } from "electron";
import ExcelJS from "exceljs";
import * as schema from "../../src/db/schema";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../src/main/controllers/auth-fixtures";
import { createReportAuditStorage } from "../../src/main/controllers/report-export-audit";
import { createReportExportHandler } from "../../src/main/controllers/report-export-service";
import { createMonthlySalesReportAdapter, createReportRegistry } from "../../src/main/controllers/report-registry";
import { context, report, reportDependencies, request, user } from "./controllers/report-export-fixture";

// Real Electron printing and transactional audit; only the native directory dialog is replaced.
const output = resolve("out/cu54-qa");
mkdirSync(join(output, "electron-user-data"), { recursive: true });
app.setPath("userData", join(output, "electron-user-data"));
if (!app.isReady()) app.disableHardwareAcceleration();
let fixture: AuthTestDatabase | undefined;
let exitCode = 0;
try {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, { usuarioId: "owner", trabajadorId: 1, rut: "11111111-1", nombre: "Ana", apellido: "Dueña" });
  const deps = reportDependencies(output, {
    audit: createReportAuditStorage(fixture.db),
    registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report, user }))]),
  });
  const files: string[] = [];
  for (const format of ["pdf", "xlsx"] as const) {
    const response = await createReportExportHandler(deps)(request, { ...context, channel: `reporte:exportar-${format}` });
    if (!response.ok) throw new Error(response.error.message);
    assert.ok("formato" in response.data);
    assert.equal(response.data.estado, "saved");
    assert.equal(response.data.cantidadFilas, 30);
    const path = join(output, `VentasMensuales_2026-09_30-09-2026.${format}`);
    assert.equal(response.data.ruta, path);
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(0, format === "pdf" ? 4 : 2).toString(), format === "pdf" ? "%PDF" : "PK");
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      const sheet = workbook.getWorksheet("Ventas mensuales")!;
      assert.equal(sheet.getCell("A1").value, "Minimarket y Panadería Huáscar");
      assert.equal(sheet.getCell("A2").value, "Reporte mensual de ventas");
      assert.equal(sheet.getCell("A4").value, "Generado: 30-09-2026 10:00");
      assert.equal(sheet.getCell("A5").value, "Usuario: Ana <Dueña>");
      assert.equal(sheet.getCell("A40").value, "30/09/2026");
      assert.equal(sheet.getCell("C11").value, 2500);
      assert.equal(sheet.getCell("C40").value, 0);
      assert.equal(sheet.getImages().length, 0);
    }
    files.push(path);
  }
  assert.equal((await fixture.db.select().from(schema.logAuditoria)).length, 2);
  assert.equal((await fixture.db.select().from(schema.usuarioVersion)).length, 1);
  assert.deepEqual(await readdir(join(output, "evidence")), []);
  assert.equal((await readdir(output)).some((name) => name.includes(".cu54-")), false);
  await writeFile(join(output, "electron-result.json"), JSON.stringify({ ok: true, rows: 30, files, audits: 2 }, null, 2));
} catch (error) {
  exitCode = 1;
  await writeFile(join(output, "electron-result.json"), JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }));
} finally {
  fixture?.client.close();
  if (fixture) await removeAuthTempDir(fixture.dir);
  app.exit(exitCode);
}
