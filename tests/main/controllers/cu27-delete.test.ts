import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import {
  createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import { authorizeRequest } from "../../../src/main/controllers/auth-guard";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";
import { shiftController } from "../../../src/main/controllers/shift";
import type { ShiftListResponse } from "../../../src/shared/shifts";

// CU27/RF27: real persistence, session authorization and transaction rollback.
// All controllers and audits use this temporary database, never local.db.
const database = vi.hoisted(() => ({ current: undefined as unknown as typeof import("../../../src/db/client").db }));
vi.mock("../../../src/db/client", async () => ({
  get db() { return database.current; },
  schema: await import("../../../src/db/schema"),
}));

let fixture: AuthTestDatabase;
const users = ["11111111-1", "22222222-2"];
const sessions = [randomUUID(), randomUUID()];
const turnoId = randomUUID();
const start = "2026-06-15T12:00:00.000Z";
const end = "2026-06-15T20:00:00.000Z";
const deletion = { turnoId, confirmacion: true };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  fixture = await createAuthTestDatabase();
  database.current = fixture.db;
  for (let i = 0; i < users.length; i++) {
    await seedUser(fixture.db, {
      usuarioId: users[i], rut: users[i], trabajadorId: i + 1,
      rolBd: i === 0 ? "dueno" : "trabajador", nombre: i === 0 ? "Maria" : "Ana", apellido: "Soto",
    });
    await fixture.db.insert(schema.sesionUsuario).values({
      sesionUsuarioId: sessions[i], usuarioId: users[i],
      sesionRolEfectivo: i === 0 ? "dueno" : "trabajador",
      sesionFechaHoraInicio: new Date().toISOString(),
      sesionFechaHoraUltimoAcceso: new Date().toISOString(),
    });
  }
  await fixture.db.insert(schema.turno).values({
    turnoId, trabajadorId: 2, turnoEstado: "planificado",
    turnoFechaHoraInicio: start, turnoFechaHoraFin: end,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (fixture) {
    fixture.client.close();
    await removeAuthTempDir(fixture.dir);
  }
});

async function request(channel: string, payload: Record<string, unknown>, index = 0) {
  const token = signSessionToken({
    usuarioId: users[index], rol: index === 0 ? "dueno" : "trabajador",
    usuarioRol: index === 0 ? "dueno" : "trabajador", passwordTemporal: false,
    sesionId: sessions[index],
  });
  const guard = await authorizeRequest(channel, { __authToken: token, ...payload });
  return guard.ok ? shiftController.handle(guard.payload, guard.context) : guard.response;
}

async function calendar() {
  const result = await request("turno:listar", { inicioSemana: "2026-06-15" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return (result.data as ShiftListResponse).turnos;
}

async function persistedShifts() {
  return fixture.db.select().from(schema.turno).orderBy(schema.turno.turnoId);
}

async function deleteAudits() {
  return fixture.db.select({
    usuarioId: schema.usuarioVersion.usuarioId,
    modulo: schema.logAuditoria.logModulo,
    descripcion: schema.logAuditoria.logDescripcion,
  }).from(schema.logAuditoria)
    .innerJoin(schema.usuarioVersion, eq(schema.logAuditoria.usuarioVersionId, schema.usuarioVersion.usuarioVersionId))
    .where(eq(schema.logAuditoria.logTipoAccion, "eliminar_turno"));
}

async function expectRejected(payload: Record<string, unknown>, code: string, index = 0) {
  const before = await persistedShifts();
  const result = await request("turno:eliminar", payload, index);
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(await persistedShifts()).toEqual(before);
  expect(await deleteAudits()).toEqual([]);
  return result;
}

describe("CU27 deleting through session authorization and the shift controller", () => {
  it("persists the DELETE, preserves unrelated shifts and audits the trusted owner identity", async () => {
    const otherId = randomUUID();
    await fixture.db.insert(schema.turno).values({
      turnoId: otherId, trabajadorId: 1, turnoEstado: "planificado",
      turnoFechaHoraInicio: start, turnoFechaHoraFin: end,
    });
    expect(await request("turno:eliminar", { ...deletion, usuarioId: users[1] }))
      .toMatchObject({ ok: true, data: { turnoId } });
    expect((await persistedShifts()).map((shift) => shift.turnoId)).toEqual([otherId]);
    // Independent SQL read proves physical deletion, not just the response flag.
    const persisted = await fixture.client.execute({ sql: "SELECT turno_id FROM turno WHERE turno_id = ?", args: [turnoId] });
    expect(persisted.rows).toEqual([]);
    expect(await deleteAudits()).toEqual([{
      usuarioId: users[0], modulo: "personal",
      descripcion: `Turno de Ana Soto eliminado (${start} - ${end}).`,
    }]);
    expect((await calendar()).map((shift) => shift.turnoId)).toEqual([otherId]);
  });

  it.each(["2026-06-13T11:59:59.000Z", "2026-06-13T12:00:00.000Z"])(
    "E1 rejects a shift whose start is past or exactly now: %s", async (inicio) => {
      await fixture.db.update(schema.turno).set({ turnoFechaHoraInicio: inicio });
      await expectRejected(deletion, "BUSINESS_RULE");
    },
  );

  it("E1 revalidates attendance registered after loading an editable calendar", async () => {
    expect(await calendar()).toMatchObject([{ turnoId, puedeModificar: true }]);
    await fixture.db.insert(schema.asistencia).values({
      asistenciaId: randomUUID(), turnoId, trabajadorId: 2, asistenciaFechaHoraEntrada: start,
    });
    const attendance = await fixture.db.select().from(schema.asistencia);
    await expectRejected(deletion, "BUSINESS_RULE");
    expect(await fixture.db.select().from(schema.asistencia)).toEqual(attendance);
  });

  it("E1 rechecks the clock when a loaded shift starts before confirmation", async () => {
    vi.setSystemTime(new Date("2026-06-15T11:59:59.000Z"));
    await fixture.db.update(schema.sesionUsuario).set({ sesionFechaHoraUltimoAcceso: new Date().toISOString() });
    expect(await calendar()).toMatchObject([{ turnoId, puedeModificar: true }]);
    vi.setSystemTime(new Date(start));
    await expectRejected(deletion, "BUSINESS_RULE");
  });

  it("revalidates a shift changed by another writer after calendar load", async () => {
    expect(await calendar()).toMatchObject([{ turnoId, puedeModificar: true }]);
    await fixture.db.update(schema.turno).set({ turnoFechaHoraInicio: new Date().toISOString() });
    await expectRejected(deletion, "BUSINESS_RULE");
  });

  it("rejects a shift removed after selection without recording a false deletion", async () => {
    expect(await calendar()).toHaveLength(1);
    await fixture.db.delete(schema.turno).where(eq(schema.turno.turnoId, turnoId));
    expect(await expectRejected(deletion, "BUSINESS_RULE"))
      .toMatchObject({ error: { message: "El turno solicitado no existe." } });
  });

  it.each([false, undefined, "true", 1])("E2 requires explicit boolean confirmation: %s", async (confirmacion) => {
    expect(await expectRejected({ ...deletion, confirmacion }, "VALIDATION_ERROR"))
      .toMatchObject({ error: { fieldErrors: { confirmacion: expect.any(String) } } });
  });

  it("requires an identified shift", async () => {
    expect(await expectRejected({ confirmacion: true }, "VALIDATION_ERROR"))
      .toMatchObject({ error: { fieldErrors: { turnoId: expect.any(String) } } });
  });

  it.each([false, true])("rejects a worker with spoofed owner identity = %s", async (spoof) => {
    await expectRejected({ ...deletion, usuarioId: users[spoof ? 0 : 1] }, "FORBIDDEN", 1);
  });

  it.each([null, "invalid"])("rejects missing or invalid tokens: %s", async (__authToken) => {
    await expectRejected({ ...deletion, __authToken }, "FORBIDDEN");
  });

  it("rejects a closed owner session", async () => {
    await fixture.db.update(schema.sesionUsuario).set({
      sesionFechaHoraCierre: new Date().toISOString(), sesionMotivoCierre: "manual",
    }).where(eq(schema.sesionUsuario.sesionUsuarioId, sessions[0]));
    await expectRejected(deletion, "FORBIDDEN");
  });

  it("rejects a session expired by inactivity", async () => {
    await fixture.db.update(schema.sesionUsuario).set({ sesionFechaHoraUltimoAcceso: "2026-06-12T12:00:00.000Z" });
    await expectRejected(deletion, "FORBIDDEN");
  });

  it("rejects an inactive owner even when their session remains open", async () => {
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" })
      .where(eq(schema.trabajador.trabajadorId, 1));
    await expectRejected(deletion, "FORBIDDEN");
  });

  it("retains the owner session role until the next login after a database role change", async () => {
    await fixture.db.update(schema.usuario).set({ usuarioRol: "trabajador" })
      .where(eq(schema.usuario.usuarioId, users[0]));
    expect(await request("turno:eliminar", deletion)).toMatchObject({ ok: true });
    expect(await persistedShifts()).toEqual([]);
    expect(await deleteAudits()).toMatchObject([{ usuarioId: users[0] }]);
  });

  it("does not promote an existing worker session when their database role becomes owner", async () => {
    await fixture.db.update(schema.usuario).set({ usuarioRol: "dueno" })
      .where(eq(schema.usuario.usuarioId, users[1]));
    await expectRejected({ ...deletion, usuarioId: users[0] }, "FORBIDDEN", 1);
  });

  it.each(["audit", "delete"])("rolls back all mutation writes if the %s fails", async (failure) => {
    await fixture.client.execute(failure === "audit" ? `
      CREATE TRIGGER cu27_fail_audit BEFORE INSERT ON log_auditoria
      WHEN NEW.log_tipo_accion = 'eliminar_turno'
      BEGIN SELECT RAISE(ABORT, 'CU27 audit failure'); END
    ` : `
      CREATE TRIGGER cu27_fail_delete BEFORE DELETE ON turno
      BEGIN SELECT RAISE(ABORT, 'CU27 delete failure'); END
    `);
    const versions = await fixture.db.select().from(schema.usuarioVersion);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRejected(deletion, "TECHNICAL_ERROR");
    expect(await fixture.db.select().from(schema.usuarioVersion)).toEqual(versions);
    expect(consoleError).toHaveBeenCalled();
  });

  it("regression CU28 -> CU26 -> CU28 -> CU27 -> CU28", async () => {
    expect(await calendar()).toMatchObject([{ turnoId, fecha: "15/06/2026", horaInicio: "08:00" }]);
    expect(await request("turno:editar", {
      turnoId, fecha: "16/06/2026", horaInicio: "09:00", horaTermino: "17:00",
    })).toMatchObject({ ok: true });
    expect(await calendar()).toMatchObject([{ turnoId, fecha: "16/06/2026", horaInicio: "09:00", horaTermino: "17:00" }]);
    expect(await request("turno:eliminar", deletion)).toMatchObject({ ok: true });
    expect(await calendar()).toEqual([]);
    expect(await persistedShifts()).toEqual([]);
    expect(await deleteAudits()).toHaveLength(1);
    expect(await fixture.db.select().from(schema.logAuditoria)
      .where(eq(schema.logAuditoria.logTipoAccion, "editar_turno"))).toHaveLength(1);
    // Retrying an already successful deletion cannot create a second audit.
    expect(await request("turno:eliminar", deletion)).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE" } });
    expect(await deleteAudits()).toHaveLength(1);
  });
});
