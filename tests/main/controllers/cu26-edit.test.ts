import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import {
  createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import { authorizeRequest } from "../../../src/main/controllers/auth-guard";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";
import { authenticateWithExecutor } from "../../../src/main/controllers/auth-login";
import { shiftController } from "../../../src/main/controllers/shift";
import type { ShiftListResponse } from "../../../src/shared/shifts";

// Every request, including session checks and audits, uses the temporary database.
const database = vi.hoisted(() => ({ current: undefined as unknown as typeof import("../../../src/db/client").db }));
vi.mock("../../../src/db/client", async () => ({
  get db() { return database.current; },
  schema: await import("../../../src/db/schema"),
}));

let fixture: AuthTestDatabase;
const users = ["11111111-1", "22222222-2"];
const sessions = [randomUUID(), randomUUID()];
const turnoId = randomUUID();
const originalStart = "2026-06-15T12:00:00.000Z";
const originalEnd = "2026-06-15T20:00:00.000Z";
const edit = { turnoId, fecha: "16/06/2026", horaInicio: "09:00", horaTermino: "17:00" };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  fixture = await createAuthTestDatabase();
  database.current = fixture.db;
  for (let i = 0; i < users.length; i++) {
    await seedUser(fixture.db, {
      usuarioId: users[i], rut: users[i], trabajadorId: i + 1,
      rolBd: i === 0 ? "dueno" : "trabajador",
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
    turnoFechaHoraInicio: originalStart, turnoFechaHoraFin: originalEnd,
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

async function persistedShifts() {
  return fixture.db.select().from(schema.turno).orderBy(schema.turno.turnoId);
}

async function editAudits() {
  return fixture.db.select({
    usuarioId: schema.usuarioVersion.usuarioId,
    modulo: schema.logAuditoria.logModulo,
    descripcion: schema.logAuditoria.logDescripcion,
  }).from(schema.logAuditoria)
    .innerJoin(schema.usuarioVersion, eq(schema.logAuditoria.usuarioVersionId, schema.usuarioVersion.usuarioVersionId))
    .where(eq(schema.logAuditoria.logTipoAccion, "editar_turno"));
}

async function expectRejected(payload: Record<string, unknown>, code: string, index = 0) {
  const before = await persistedShifts();
  const result = await request("turno:editar", payload, index);
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(await persistedShifts()).toEqual(before);
  expect(await editAudits()).toEqual([]);
  return result;
}

describe("CU26 edición mediante autorización de sesión y controlador de turnos", () => {
  it.each([0, 1])("carga V18 por ID con datos actuales y permisos de sesión para el rol %i", async (index) => {
    await fixture.db.update(schema.turno).set({ turnoFechaHoraInicio: "2026-07-20T13:00:00.000Z", turnoFechaHoraFin: "2026-07-20T21:00:00.000Z" });
    expect(await request("turno:listar", { consulta: "turno", turnoId, usuarioId: users[0] }, index))
      .toMatchObject({ ok: true, data: { turno: {
        turnoId, fecha: "20/07/2026", horaInicio: "09:00", horaTermino: "17:00", puedeModificar: index === 0,
      } } });
    expect(await editAudits()).toEqual([]);
  });

  it("no expone un trabajador inactivo en la consulta por ID", async () => {
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" })
      .where(eq(schema.trabajador.trabajadorId, 2));
    expect(await request("turno:listar", { consulta: "turno", turnoId }))
      .toMatchObject({ ok: false, error: { code: "BUSINESS_RULE" } });
  });

  it("informa un turno inexistente en lugar de cargar un calendario no relacionado", async () => {
    expect(await request("turno:listar", { consulta: "turno", turnoId: randomUUID() }))
      .toMatchObject({ ok: false, error: { code: "BUSINESS_RULE" } });
  });

  it.each([
    { consulta: "unknown", inicioSemana: "2026-06-15" },
    { consulta: null, inicioSemana: "2026-06-15" },
    { consulta: "turno" }, { consulta: "turno", turnoId: 12 },
    { consulta: "turno", turnoId: "   " },
  ])("rechaza consulta malformada sin respaldo semanal: %j", async (payload) => {
    expect(await request("turno:listar", payload)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("bloquea el editor cuando aparece asistencia después de su consulta", async () => {
    expect(await request("turno:listar", { consulta: "turno", turnoId }))
      .toMatchObject({ ok: true, data: { turno: { puedeModificar: true } } });
    await fixture.db.insert(schema.asistencia).values({
      asistenciaId: randomUUID(), turnoId, trabajadorId: 2, asistenciaFechaHoraEntrada: originalStart,
    });
    await expectRejected(edit, "BUSINESS_RULE");
  });

  it("mantiene la creación consistente con el rol de sesión del dueño", async () => {
    await fixture.db.update(schema.usuario).set({ usuarioRol: "trabajador" })
      .where(eq(schema.usuario.usuarioId, users[0]));
    expect(await request("turno:crear", {
      trabajadorId: 2, fecha: "17/06/2026", horaInicio: "09:00", horaTermino: "17:00", usuarioId: users[1],
    })).toMatchObject({ ok: true });
    expect(await persistedShifts()).toHaveLength(2);
    const [audit] = await fixture.db.select({ usuarioId: schema.usuarioVersion.usuarioId })
      .from(schema.logAuditoria).innerJoin(schema.usuarioVersion, eq(schema.logAuditoria.usuarioVersionId, schema.usuarioVersion.usuarioVersionId))
      .where(eq(schema.logAuditoria.logTipoAccion, "crear_turno"));
    expect(audit.usuarioId).toBe(users[0]);
  });

  it.each([0, 1])("aplica el rol modificado en la base de datos en un nuevo inicio de sesión: usuario %i", async (index) => {
    const newRole = index === 0 ? "trabajador" : "dueno";
    await fixture.db.update(schema.usuario).set({ usuarioRol: newRole })
      .where(eq(schema.usuario.usuarioId, users[index]));
    const login = await authenticateWithExecutor(fixture.db, schema, { usuario: users[index], contrasena: "test-password" }, {
      comparePassword: async () => true, signToken: signSessionToken, now: () => new Date(),
    });
    expect(login).toMatchObject({ ok: true, data: { role: newRole } });
    if (!login.ok) throw new Error(login.error.message);
    const result = await request("turno:editar", { ...edit, __authToken: login.data.token }, index);
    expect(result).toMatchObject(index === 0 ? { ok: false, error: { code: "FORBIDDEN" } } : { ok: true });
  });

  it.each(["turno:crear", "turno:editar", "turno:eliminar"])("rechaza contexto de confianza ausente para %s", async (channel) => {
    const before = await persistedShifts();
    expect(await shiftController.handle({ ...edit, trabajadorId: 2, confirmacion: true, usuarioId: users[0] }, { channel }))
      .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await persistedShifts()).toEqual(before);
  });

  it("informa un fallo técnico de autorización sin modificar el turno", async () => {
    const select = vi.spyOn(fixture.db, "select").mockImplementationOnce(() => { throw new Error("Account read failed"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await request("turno:editar", edit)).toMatchObject({ ok: false, error: { code: "TECHNICAL_ERROR" } });
    select.mockRestore();
    expect(await persistedShifts()).toMatchObject([{ turnoFechaHoraInicio: originalStart }]);
    expect(await editAudits()).toEqual([]);
  });

  it("conserva el rol de sesión del dueño hasta el siguiente inicio de sesión tras un cambio de rol en la base de datos", async () => {
    await fixture.db.update(schema.usuario).set({ usuarioRol: "trabajador" })
      .where(eq(schema.usuario.usuarioId, users[0]));
    expect(await request("turno:editar", edit)).toMatchObject({ ok: true });
    expect(await persistedShifts()).toMatchObject([{ turnoFechaHoraInicio: "2026-06-16T13:00:00.000Z" }]);
    expect(await editAudits()).toMatchObject([{ usuarioId: users[0] }]);
  });

  it("persiste ambas marcas de tiempo, conserva el trabajador y audita la identidad de sesión de confianza", async () => {
    expect(await request("turno:editar", { ...edit, usuarioId: users[1], trabajadorId: 1 }))
      .toMatchObject({ ok: true, data: { turnoId } });
    expect(await persistedShifts()).toMatchObject([{
      turnoId, trabajadorId: 2, turnoEstado: "planificado",
      turnoFechaHoraInicio: "2026-06-16T13:00:00.000Z",
      turnoFechaHoraFin: "2026-06-16T21:00:00.000Z",
    }]);
    expect(await editAudits()).toEqual([{
      usuarioId: users[0], modulo: "personal",
      descripcion: expect.stringContaining("16/06/2026 09:00-17:00"),
    }]);
    const result = await request("turno:listar", { inicioSemana: "2026-06-15" }, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect((result.data as ShiftListResponse).turnos).toMatchObject([{
      turnoId, trabajadorId: 2, fecha: "16/06/2026",
      horaInicio: "09:00", horaTermino: "17:00", puedeModificar: false,
    }]);
  });

  it.each(["2026-06-13T11:59:59.000Z", "2026-06-13T12:00:00.000Z"])(
    "E1 rechaza un turno que inició en %s", async (start) => {
      await fixture.db.update(schema.turno).set({ turnoFechaHoraInicio: start });
      await expectRejected(edit, "BUSINESS_RULE");
    },
  );

  it("E1 rechaza editar un turno futuro con asistencia registrada", async () => {
    await fixture.db.insert(schema.asistencia).values({
      asistenciaId: randomUUID(), turnoId, trabajadorId: 2,
      asistenciaFechaHoraEntrada: originalStart,
    });
    await expectRejected(edit, "BUSINESS_RULE");
  });

  it("E2 rechaza un solapamiento con otro turno del trabajador original", async () => {
    await fixture.db.insert(schema.turno).values({
      turnoId: randomUUID(), trabajadorId: 2, turnoEstado: "planificado",
      turnoFechaHoraInicio: "2026-06-16T20:00:00.000Z",
      turnoFechaHoraFin: "2026-06-16T22:00:00.000Z",
    });
    await expectRejected({ ...edit, trabajadorId: 1 }, "BUSINESS_RULE");
  });

  it("E2 permite turnos contiguos y no entra en conflicto con el propio turno editado", async () => {
    await fixture.db.insert(schema.turno).values({
      turnoId: randomUUID(), trabajadorId: 2, turnoEstado: "planificado",
      turnoFechaHoraInicio: originalEnd,
      turnoFechaHoraFin: "2026-06-15T22:00:00.000Z",
    });
    expect(await request("turno:editar", {
      ...edit, fecha: "15/06/2026", horaInicio: "09:00", horaTermino: "16:00",
    })).toMatchObject({ ok: true });
    expect(await editAudits()).toHaveLength(1);
  });

  it.each(["08:00", "09:00"])("E3 rechaza hora de término %s <= hora de inicio", async (horaTermino) => {
    expect(await expectRejected({ ...edit, horaTermino }, "VALIDATION_ERROR"))
      .toMatchObject({ error: { fieldErrors: { horaTermino: expect.any(String) } } });
  });

  it("revierte la actualización del turno cuando falla la inserción de la auditoría", async () => {
    await fixture.client.execute(`
      CREATE TRIGGER cu26_fail_edit_audit BEFORE INSERT ON log_auditoria
      WHEN NEW.log_tipo_accion = 'editar_turno'
      BEGIN SELECT RAISE(ABORT, 'CU26 audit failure'); END
    `);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRejected(edit, "TECHNICAL_ERROR");
    expect(consoleError).toHaveBeenCalled();
  });

  it("rechaza a un trabajador aunque use un ID de dueño falsificado", async () => {
    await expectRejected({ ...edit, usuarioId: users[0] }, "FORBIDDEN", 1);
  });

  it("rechaza un token inválido", async () => {
    await expectRejected({ ...edit, __authToken: "invalid" }, "FORBIDDEN");
  });

  it("rechaza una sesión cerrada", async () => {
    await fixture.db.update(schema.sesionUsuario).set({
      sesionFechaHoraCierre: new Date().toISOString(), sesionMotivoCierre: "manual",
    }).where(eq(schema.sesionUsuario.sesionUsuarioId, sessions[0]));
    await expectRejected(edit, "FORBIDDEN");
  });
});
