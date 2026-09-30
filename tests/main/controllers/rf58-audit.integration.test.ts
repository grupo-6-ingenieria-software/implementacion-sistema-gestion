import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { applyTriggers } from "../../../src/db/init";
import { registerAuditLog } from "../../../src/main/controllers/auth-context";
import { queryAuditLog, registerAuditEvent } from "../../../src/main/controllers/audit-service";
import { authenticateWithExecutor } from "../../../src/main/controllers/auth-login";
import { guardChannel } from "../../../src/main/controllers/auth-guard";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";
import { validateAccessWithExecutor } from "../../../src/main/controllers/access-control";
import {
  createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

const NOW = new Date("2026-09-29T15:00:00.000Z");
const OWNER = "12345678-9";
const WORKER = "23456789-0";
let fixture: AuthTestDatabase;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, { usuarioId: OWNER, rut: OWNER, trabajadorId: 1 });
  await seedUser(fixture.db, {
    usuarioId: WORKER, rut: WORKER, trabajadorId: 2, rolBd: "trabajador",
    nombre: "Camila", apellido: "Rojas",
  });
  await applyTriggers(fixture.client, join(process.cwd(), "src/db/triggers.sql"));
});

afterEach(async () => {
  vi.useRealTimers();
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

async function record(tipoAccion = "registro", usuarioId = OWNER) {
  await registerAuditLog(fixture.db, schema, {
    descripcion: `Evento ${tipoAccion}`, modulo: "inventario", tipoAccion, usuarioId,
  });
  return (await fixture.db.select().from(schema.logAuditoria)).at(-1)!;
}

async function datedRecord(fechaHora: string, action: string, versionId: string) {
  await fixture.db.insert(schema.logAuditoria).values({
    logFechaHora: fechaHora, logTipoAccion: action, logModulo: "inventario",
    logDescripcion: action, usuarioVersionId: versionId,
  });
}

describe("RF58 / CU58 / CP62", () => {
  it("records a successful login with a version of the authenticated user", async () => {
    const response = await authenticateWithExecutor(fixture.db, schema, {
      usuario: OWNER, contrasena: "test-secret",
    }, {
      comparePassword: async () => true, signToken: () => "test-token", now: () => NOW,
    });
    expect(response.ok).toBe(true);
    const rows = await fixture.db.all<{ accion: string; nombre: string; rol: string; usuarioId: string; descripcion: string }>(sql`
      SELECT la.log_tipo_accion AS accion, uv.usuario_version_nombre AS nombre,
        uv.usuario_version_rol AS rol, uv.usuario_id AS usuarioId, la.log_descripcion AS descripcion
      FROM log_auditoria la JOIN usuario_version uv USING (usuario_version_id)
    `);
    expect(rows).toEqual([expect.objectContaining({
      accion: "inicio_sesion", nombre: "María Huáscar", rol: "dueno", usuarioId: OWNER,
    })]);
    expect(rows[0].descripcion).not.toContain("test-secret");
  });

  it("limits entries, totals and options to twelve months while preserving old records", async () => {
    const row = await record();
    const version = row.usuarioVersionId;
    await datedRecord("2025-09-29T14:59:59.999Z", "old-only", version);
    await datedRecord("2025-09-29T15:00:00.000Z", "boundary", version);
    await datedRecord("2026-09-29T15:00:00.001Z", "future-only", version);
    const response = await queryAuditLog(fixture.db, schema, {
      usuarioId: OWNER, fechaDesde: "2020-01-01", fechaHasta: "2030-01-01",
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.data.total).toBe(2);
    expect(response.data.entries.map((entry) => entry.tipoAccion)).toEqual(["registro", "boundary"]);
    expect(response.data.filters.tiposAccion).not.toContain("old-only");
    expect(response.data.filters.tiposAccion).not.toContain("future-only");
    expect(response.data.periodoConsulta).toEqual({
      desde: "2025-09-29T15:00:00.000Z", hasta: NOW.toISOString(),
    });
    expect((await fixture.db.select().from(schema.logAuditoria))).toHaveLength(5);
    const oldResponse = await queryAuditLog(fixture.db, schema, {
      usuarioId: OWNER, fechaHasta: "2025-01-01",
    });
    expect(oldResponse).toMatchObject({ ok: true, data: { entries: [], total: 0, totalPages: 1 } });
  });

  it("applies Chilean whole-day filters with milliseconds and stable pagination", async () => {
    const { usuarioVersionId } = await record();
    for (const date of ["2026-06-11T03:59:59.999Z", "2026-06-11T04:00:00.000Z",
      "2026-06-12T03:59:59.998Z", "2026-06-11T23:59:59.999-04:00", "2026-06-12T04:00:00.000Z"]) {
      await datedRecord(date, "edicion", usuarioVersionId);
    }
    const filters = { usuarioId: OWNER, fechaDesde: "2026-06-11", fechaHasta: "2026-06-11", tipoAccion: "edicion", pageSize: 2 };
    const first = await queryAuditLog(fixture.db, schema, filters);
    const second = await queryAuditLog(fixture.db, schema, { ...filters, page: 2 });
    expect(first).toMatchObject({ ok: true, data: { total: 3, totalPages: 2 } });
    expect(second).toMatchObject({ ok: true, data: { total: 3, totalPages: 2 } });
    if (!first.ok || !second.ok) return;
    expect(first.data.entries.map((entry) => entry.fechaHora)).toEqual([
      "2026-06-11T23:59:59.999-04:00", "2026-06-12T03:59:59.998Z",
    ]);
    expect(second.data.entries[0].fechaHora).toBe("2026-06-11T04:00:00.000Z");
    expect(new Set([...first.data.entries, ...second.data.entries].map((entry) => entry.id)).size).toBe(3);
  });

  it("keeps the original identity when the user name and role change", async () => {
    const old = await record("edicion", WORKER);
    await fixture.db.run(sql`UPDATE usuario_version SET usuario_version_fecha_hora_vigencia_hasta = ${NOW.toISOString()} WHERE usuario_version_id = ${old.usuarioVersionId}`);
    await fixture.db.run(sql`UPDATE trabajador SET trabajador_nombre = 'Carolina' WHERE trabajador_id = 2`);
    await fixture.db.run(sql`UPDATE usuario SET usuario_rol = 'dueno' WHERE usuario_id = ${WORKER}`);
    await record("registro", WORKER);
    const response = await queryAuditLog(fixture.db, schema, { usuarioId: OWNER, usuarioFiltroId: WORKER });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipoAccion: "edicion", usuarioNombre: "Camila Rojas", rol: "trabajador" }),
      expect.objectContaining({ tipoAccion: "registro", usuarioNombre: "Carolina Rojas", rol: "dueno" }),
    ]));
  });

  it("denies a worker query using the effective session role and records it once", async () => {
    const response = await queryAuditLog(fixture.db, schema, { usuarioId: OWNER }, "trabajador");
    expect(response).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([
      expect.objectContaining({ logTipoAccion: "acceso_denegado" }),
    ]);
  });

  it("persists denied IPC and direct navigation attempts with the trusted user", async () => {
    const claims = { usuarioId: WORKER, rol: "trabajador" as const, usuarioRol: "trabajador", passwordTemporal: false, sesionId: "00000000-0000-4000-8000-000000000777" };
    const guarded = await guardChannel("auditoria:consultar", { usuarioId: OWNER, __authToken: "token" }, {
      verifyToken: () => claims, audit: (event) => registerAuditLog(fixture.db, schema, event),
    });
    expect(guarded.ok).toBe(false);
    const navigation = await validateAccessWithExecutor(fixture.db, schema, {
      token: signSessionToken(claims), ruta: "/app/admin/auditoria",
    });
    expect(navigation).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const rows = await fixture.db.all<{ usuarioId: string; accion: string }>(sql`
      SELECT uv.usuario_id AS usuarioId, la.log_tipo_accion AS accion
      FROM log_auditoria la JOIN usuario_version uv USING (usuario_version_id)
    `);
    expect(rows).toEqual([
      { usuarioId: WORKER, accion: "acceso_denegado" }, { usuarioId: WORKER, accion: "acceso_denegado" },
    ]);
  });

  it("rejects incomplete registrations and reports persistence failures", async () => {
    expect(await registerAuditEvent(fixture.db, schema, { usuarioId: OWNER }))
      .toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const failingDatabase = { ...fixture.db, all: async () => { throw new Error("unavailable"); },
      select: fixture.db.select.bind(fixture.db), insert: fixture.db.insert.bind(fixture.db) };
    expect(await queryAuditLog(failingDatabase, schema, { usuarioId: OWNER }))
      .toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });

  it("blocks UPDATE, DELETE, REPLACE and UPSERT without changing the record", async () => {
    const row = await record();
    for (const statement of [
      sql`UPDATE log_auditoria SET log_descripcion = 'alterado' WHERE log_auditoria_id = ${row.logAuditoriaId}`,
      sql`DELETE FROM log_auditoria WHERE log_auditoria_id = ${row.logAuditoriaId}`,
      sql`INSERT OR REPLACE INTO log_auditoria SELECT * FROM log_auditoria WHERE log_auditoria_id = ${row.logAuditoriaId}`,
      sql`INSERT INTO log_auditoria SELECT * FROM log_auditoria WHERE log_auditoria_id = ${row.logAuditoriaId} ON CONFLICT(log_auditoria_id) DO UPDATE SET log_descripcion = 'alterado'`,
      sql`UPDATE usuario_version SET usuario_version_nombre = 'alterado' WHERE usuario_version_id = ${row.usuarioVersionId}`,
      sql`INSERT OR REPLACE INTO usuario_version SELECT * FROM usuario_version WHERE usuario_version_id = ${row.usuarioVersionId}`,
    ]) {
      await expect(fixture.db.run(statement)).rejects.toMatchObject({
        cause: { message: expect.stringContaining("inmutable") },
      });
    }
    expect(await fixture.db.select().from(schema.logAuditoria)).toEqual([row]);
  });
});
