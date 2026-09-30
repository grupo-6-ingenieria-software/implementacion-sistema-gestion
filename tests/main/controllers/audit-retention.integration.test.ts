import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { sql, type SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { applyTriggers } from "../../../src/db/init";
import { getAuditLogWindow } from "../../../src/shared/audit";
import {
  auditRetentionCutoffExpression,
  purgeExpiredAuditLogs,
} from "../../../src/main/controllers/audit-retention-service";
import { registerAuditLog } from "../../../src/main/controllers/auth-context";
import {
  createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

const USER = "12345678-9";
const triggersPath = join(process.cwd(), "src/db/triggers.sql");
let fixture: AuthTestDatabase;
let versionId: string;

beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, { usuarioId: USER, rut: USER, trabajadorId: 1 });
  await applyTriggers(fixture.client, triggersPath);
  await registerAuditLog(fixture.db, schema, {
    usuarioId: USER, tipoAccion: "registro", modulo: "inventario", descripcion: "Vigente",
  });
  versionId = (await fixture.db.select().from(schema.logAuditoria))[0].usuarioVersionId;
});

afterEach(async () => {
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

async function insert(fecha: SQL, action: string): Promise<void> {
  await fixture.db.run(sql`
    INSERT INTO log_auditoria
      (log_auditoria_id, log_fecha_hora, log_tipo_accion, log_modulo, log_descripcion, usuario_version_id)
    VALUES (${crypto.randomUUID()}, ${fecha}, ${action}, 'inventario', ${action}, ${versionId})
  `);
}

describe("RF58 / RNF09 twelve-month deletion", () => {
  it.each([
    "2024-02-29T15:16:17.123Z", "2026-09-29T15:00:00.000Z",
    "2025-02-28T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
  ])("matches the shared cutoff with SQLite 3.45 for %s", async (now) => {
    const rows = await fixture.db.all<{ cutoff: string }>(sql`
      SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ${auditRetentionCutoffExpression(sql`${now}`)}) AS cutoff
    `);
    expect(rows[0].cutoff).toBe(getAuditLogWindow(new Date(now)).desde);
  });

  it("deletes expired and boundary records while preserving current and invalid dates", async () => {
    const cutoff = auditRetentionCutoffExpression();
    await insert(sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${cutoff} - 1)`, "expired");
    await insert(sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${cutoff})`, "boundary");
    await insert(sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${cutoff} + 1)`, "inside-window");
    await insert(sql`'invalid-date'`, "invalid");

    expect(await purgeExpiredAuditLogs(fixture.db)).toBe(2);
    expect(await purgeExpiredAuditLogs(fixture.db)).toBe(0);
    expect((await fixture.db.select().from(schema.logAuditoria)).map((entry) => entry.logTipoAccion))
      .toEqual(["registro", "inside-window", "invalid"]);
    expect(await fixture.db.select().from(schema.usuarioVersion)).toHaveLength(1);
    expect(await fixture.db.select().from(schema.usuario)).toHaveLength(1);
  });

  it("prevents a broad manual deletion from removing retained or invalid records", async () => {
    await insert(sql`'invalid-date'`, "invalid");
    await expect(fixture.db.run(sql`DELETE FROM log_auditoria`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining("antes de 12 meses") },
    });
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(2);
  });

  it("keeps expired records protected against edits and replacements before cleanup", async () => {
    await insert(sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${auditRetentionCutoffExpression()} - 1)`, "expired");
    for (const query of [
      sql`UPDATE log_auditoria SET log_descripcion = 'alterado' WHERE log_tipo_accion = 'expired'`,
      sql`INSERT OR REPLACE INTO log_auditoria SELECT * FROM log_auditoria WHERE log_tipo_accion = 'expired'`,
    ]) {
      await expect(fixture.db.run(query)).rejects.toMatchObject({
        cause: { message: expect.stringContaining("inmutable") },
      });
    }
    expect(await purgeExpiredAuditLogs(fixture.db)).toBe(1);
  });

  it("upgrades the old absolute DELETE trigger idempotently", async () => {
    await fixture.client.executeMultiple(`
      DROP TRIGGER trg_log_auditoria_no_delete;
      CREATE TRIGGER trg_log_auditoria_no_delete BEFORE DELETE ON log_auditoria
      BEGIN SELECT RAISE(ABORT, 'old absolute DELETE block'); END;
    `);
    await insert(sql`strftime('%Y-%m-%dT%H:%M:%fZ', ${auditRetentionCutoffExpression()} - 1)`, "expired");
    await expect(purgeExpiredAuditLogs(fixture.db)).rejects.toThrow();
    await applyTriggers(fixture.client, triggersPath);
    await applyTriggers(fixture.client, triggersPath);
    expect(await purgeExpiredAuditLogs(fixture.db)).toBe(1);
    await expect(fixture.db.run(sql`DELETE FROM log_auditoria`)).rejects.toThrow();
  });

  it("restores the previous protection when a trigger upgrade fails", async () => {
    const badScript = join(fixture.dir, "failed-trigger-upgrade.sql");
    await writeFile(badScript, `
      DROP TRIGGER trg_log_auditoria_no_delete;
      SELECT * FROM nonexistent_upgrade_table;
    `);
    await expect(applyTriggers(fixture.client, badScript)).rejects.toThrow();
    await expect(fixture.db.run(sql`DELETE FROM log_auditoria`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining("antes de 12 meses") },
    });
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(1);
  });
});
