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

describe("eliminación de turnos CU27 mediante autorización de sesión y controlador de turnos", () => {
  it("persiste el DELETE, conserva los turnos no relacionados y audita la identidad de confianza del dueño", async () => {
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
    "E1 rechaza un turno cuyo inicio es pasado o exactamente el momento actual: %s", async (inicio) => {
      await fixture.db.update(schema.turno).set({ turnoFechaHoraInicio: inicio });
      await expectRejected(deletion, "BUSINESS_RULE");
    },
  );

  it("E1 revalida la asistencia registrada después de cargar un calendario editable", async () => {
    expect(await calendar()).toMatchObject([{ turnoId, puedeModificar: true }]);
    await fixture.db.insert(schema.asistencia).values({
      asistenciaId: randomUUID(), turnoId, trabajadorId: 2, asistenciaFechaHoraEntrada: start,
    });
    const attendance = await fixture.db.select().from(schema.asistencia);
    await expectRejected(deletion, "BUSINESS_RULE");
    expect(await fixture.db.select().from(schema.asistencia)).toEqual(attendance);
  });

  it("E1 vuelve a verificar el reloj cuando un turno cargado inicia antes de la confirmación", async () => {
    vi.setSystemTime(new Date("2026-06-15T11:59:59.000Z"));
    await fixture.db.update(schema.sesionUsuario).set({ sesionFechaHoraUltimoAcceso: new Date().toISOString() });
    expect(await calendar()).toMatchObject([{ turnoId, puedeModificar: true }]);
    vi.setSystemTime(new Date(start));
    await expectRejected(deletion, "BUSINESS_RULE");
  });

  it("revalida un turno modificado por otro escritor tras cargar el calendario", async () => {
    expect(await calendar()).toMatchObject([{ turnoId, puedeModificar: true }]);
    await fixture.db.update(schema.turno).set({ turnoFechaHoraInicio: new Date().toISOString() });
    await expectRejected(deletion, "BUSINESS_RULE");
  });

  it("rechaza un turno eliminado tras la selección sin registrar una eliminación falsa", async () => {
    expect(await calendar()).toHaveLength(1);
    await fixture.db.delete(schema.turno).where(eq(schema.turno.turnoId, turnoId));
    expect(await expectRejected(deletion, "BUSINESS_RULE"))
      .toMatchObject({ error: { message: "El turno solicitado no existe." } });
  });

  it.each([false, undefined, "true", 1])("E2 exige una confirmación booleana explícita: %s", async (confirmacion) => {
    expect(await expectRejected({ ...deletion, confirmacion }, "VALIDATION_ERROR"))
      .toMatchObject({ error: { fieldErrors: { confirmacion: expect.any(String) } } });
  });

  it("exige un turno identificado", async () => {
    expect(await expectRejected({ confirmacion: true }, "VALIDATION_ERROR"))
      .toMatchObject({ error: { fieldErrors: { turnoId: expect.any(String) } } });
  });

  it.each([false, true])("rechaza a un trabajador con identidad de dueño suplantada = %s", async (spoof) => {
    await expectRejected({ ...deletion, usuarioId: users[spoof ? 0 : 1] }, "FORBIDDEN", 1);
  });

  it.each([null, "invalid"])("rechaza tokens ausentes o inválidos: %s", async (__authToken) => {
    await expectRejected({ ...deletion, __authToken }, "FORBIDDEN");
  });

  it("rechaza una sesión de dueño cerrada", async () => {
    await fixture.db.update(schema.sesionUsuario).set({
      sesionFechaHoraCierre: new Date().toISOString(), sesionMotivoCierre: "manual",
    }).where(eq(schema.sesionUsuario.sesionUsuarioId, sessions[0]));
    await expectRejected(deletion, "FORBIDDEN");
  });

  it("rechaza una sesión expirada por inactividad", async () => {
    await fixture.db.update(schema.sesionUsuario).set({ sesionFechaHoraUltimoAcceso: "2026-06-12T12:00:00.000Z" });
    await expectRejected(deletion, "FORBIDDEN");
  });

  it("rechaza a un dueño inactivo aunque su sesión siga abierta", async () => {
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" })
      .where(eq(schema.trabajador.trabajadorId, 1));
    await expectRejected(deletion, "FORBIDDEN");
  });

  it("conserva el rol de dueño de la sesión hasta el próximo inicio de sesión tras un cambio de rol en la base de datos", async () => {
    await fixture.db.update(schema.usuario).set({ usuarioRol: "trabajador" })
      .where(eq(schema.usuario.usuarioId, users[0]));
    expect(await request("turno:eliminar", deletion)).toMatchObject({ ok: true });
    expect(await persistedShifts()).toEqual([]);
    expect(await deleteAudits()).toMatchObject([{ usuarioId: users[0] }]);
  });

  it("no eleva una sesión de trabajador existente cuando su rol en la base de datos pasa a ser dueño", async () => {
    await fixture.db.update(schema.usuario).set({ usuarioRol: "dueno" })
      .where(eq(schema.usuario.usuarioId, users[1]));
    await expectRejected({ ...deletion, usuarioId: users[0] }, "FORBIDDEN", 1);
  });

  it.each(["audit", "delete"])("revierte todas las escrituras de mutación si falla %s", async (failure) => {
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

  it("regresión CU28 -> CU26 -> CU28 -> CU27 -> CU28", async () => {
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
