import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { authorizeRequest } from "../../../src/main/controllers/auth-guard";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";
import { shiftController, listShifts } from "../../../src/main/controllers/shift";
import { workerController } from "../../../src/main/controllers/worker";
import type { ShiftListResponse } from "../../../src/shared/shifts";
import type { AttendanceWorkerOption } from "../../../src/shared/attendance";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";

// Redirect the production controllers to the fixture, never the configured database.
const database = vi.hoisted(() => ({ current: undefined as unknown as typeof import("../../../src/db/client").db }));
vi.mock("../../../src/db/client", async () => ({
  get db() { return database.current; },
  schema: await import("../../../src/db/schema"),
}));

let fixture: AuthTestDatabase;
const users = ["11111111-1", "22222222-2", "33333333-3"];
const sessions = ["owner-session", "worker-session", "inactive-session"].map((id) => id.padEnd(36, "0"));
const shiftId = (name: string) => name.padEnd(36, "0");
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  database.current = fixture.db;
  for (let i = 0; i < users.length; i++) {
    await seedUser(fixture.db, {
      usuarioId: users[i], rut: users[i], trabajadorId: i + 1,
      rolBd: i === 0 ? "dueno" : "trabajador",
      estado: i === 2 ? "inactivo" : "activo", nombre: `Persona ${i + 1}`,
    });
    await fixture.db.insert(schema.sesionUsuario).values({
      sesionUsuarioId: sessions[i], usuarioId: users[i],
      sesionRolEfectivo: i === 0 ? "dueno" : "trabajador",
      sesionFechaHoraInicio: new Date().toISOString(),
      sesionFechaHoraUltimoAcceso: new Date().toISOString(),
    });
  }
});
afterEach(async () => {
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

function token(index: number) {
  return signSessionToken({
    usuarioId: users[index], rol: index === 0 ? "dueno" : "trabajador",
    usuarioRol: index === 0 ? "dueno" : "trabajador", passwordTemporal: false,
    sesionId: sessions[index],
  });
}
async function request(channel: string, payload: Record<string, unknown> = {}, index = 1) {
  const guard = await authorizeRequest(channel, { __authToken: token(index), ...payload }, () => undefined);
  if (!guard.ok) return guard.response;
  return (channel.startsWith("turno:") ? shiftController : workerController).handle(guard.payload, guard.context);
}
async function seedShift(id: string, worker: number, start: string, end?: string) {
  await fixture.db.insert(schema.turno).values({
    turnoId: shiftId(id), trabajadorId: worker, turnoEstado: "planificado",
    turnoFechaHoraInicio: start,
    turnoFechaHoraFin: end ?? new Date(Date.parse(start) + 15 * 60000).toISOString(),
  });
}
async function calendar(payload: Record<string, unknown>, index = 1) {
  const result = await request("turno:listar", payload, index);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data as ShiftListResponse;
}

describe("calendario persistido de CU28 a través del guard de solicitudes y el controlador", () => {
  it.each([0, 1])("devuelve los turnos de todos los trabajadores activos al rol %i", async (index) => {
    await seedShift("owner", 1, "2099-01-05T12:00:00Z");
    await seedShift("worker", 2, "2099-01-06T12:00:00Z");
    await seedShift("inactive", 3, "2099-01-07T12:00:00Z");
    const before = await fixture.db.select().from(schema.turno);
    const result = await calendar({ inicioSemana: "2099-01-05", usuarioId: users[0] }, index);
    expect(result.turnos.map((s) => s.turnoId)).toEqual(["owner", "worker"].map(shiftId));
    expect(result.turnos.every((s) => s.puedeModificar === (index === 0))).toBe(true);
    expect(await fixture.db.select().from(schema.turno)).toEqual(before);
  });

  it("filtra por otro trabajador activo, admite cadenas numéricas y mantiene resultados vacíos", async () => {
    await seedShift("one", 1, "2026-09-07T12:00:00Z");
    await seedShift("two", 2, "2026-09-07T13:00:00Z");
    expect((await calendar({ inicioSemana: "2026-09-07", trabajadorId: "1" })).turnos.map((s) => s.turnoId)).toEqual([shiftId("one")]);
    for (const trabajadorId of [3, 999]) {
      expect((await calendar({ inicioSemana: "2026-09-07", trabajadorId })).turnos).toEqual([]);
    }
    expect((await calendar({ inicioSemana: "2026-09-14" })).turnos).toEqual([]);
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" }).where(eq(schema.trabajador.trabajadorId, 1));
    expect((await calendar({ inicioSemana: "2026-09-07", trabajadorId: 1 })).turnos).toEqual([]);
  });

  it.each([
    ["2026-08-31", "2026-08-31T04:00:00Z", "2026-09-07T03:00:00Z"],
    ["2026-03-30", "2026-03-30T03:00:00Z", "2026-04-06T04:00:00Z"],
    ["2025-12-29", "2025-12-29T03:00:00Z", "2026-01-05T03:00:00Z"],
  ])("respeta los límites de semana de Chile ante cambios de horario de verano o de año: %s", async (week, start, end) => {
    await seedShift("before", 1, new Date(Date.parse(start) - 60000).toISOString());
    await seedShift("first", 1, start);
    await seedShift("last", 1, new Date(Date.parse(end) - 60000).toISOString());
    await seedShift("after", 1, end);
    expect((await calendar({ inicioSemana: week })).turnos.map((s) => s.turnoId)).toEqual(["first", "last"].map(shiftId));
  });

  it("muestra las horas repetidas del otoño chileno sin descartar ningún turno", async () => {
    await seedShift("first-2330", 1, "2026-04-05T02:30:00Z");
    await seedShift("second-2330", 2, "2026-04-05T03:30:00Z");
    const { turnos } = await calendar({ inicioSemana: "2026-03-30" });
    expect(turnos.map((s) => [s.fechaIso, s.horaInicio])).toEqual([
      ["2026-04-04", "23:30"], ["2026-04-04", "23:30"],
    ]);
  });

  it("no devuelve turnos cuando no quedan trabajadores activos (consulta de servicio)", async () => {
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" });
    const result = await listShifts(fixture.db as unknown as DbExecutor, { inicioSemana: "2026-09-07" }, { role: "trabajador", usuarioId: users[1] });
    expect(result.turnos).toEqual([]);
  });

  it.each([0, -1, 1.5, "garbage", null])("rechaza filtros malformados en el controlador: %j", async (trabajadorId) => {
    expect(await request("turno:listar", { inicioSemana: "2026-09-07", trabajadorId })).toMatchObject({
      ok: false, error: { code: "VALIDATION_ERROR", fieldErrors: { trabajadorId: expect.any(String) } },
    });
  });

  it.each(["turno:crear", "turno:editar", "turno:eliminar"])("deniega la mutación directa %s incluso con un ID de dueño falsificado", async (channel) => {
    expect(await request(channel, { usuarioId: users[0] })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await fixture.db.select().from(schema.turno)).toEqual([]);
  });

  it.each(["turno:listar", "trabajador:listar-activos"])("rechaza tokens inválidos y sesiones cerradas para %s", async (channel) => {
    const input = { inicioSemana: "2026-09-07", contexto: "calendario" };
    expect(await request(channel, { ...input, __authToken: "invalid" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await fixture.db.update(schema.sesionUsuario).set({ sesionFechaHoraCierre: new Date().toISOString(), sesionMotivoCierre: "manual" });
    expect(await request(channel, input)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rechaza a un solicitante inactivo incluso con sesión abierta", async () => {
    expect(await request("turno:listar", { inicioSemana: "2026-09-07" }, 2)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("mantiene la sesión de trabajador en solo lectura aunque cambie el rol de la base de datos", async () => {
    await seedShift("future", 1, "2099-01-05T12:00:00Z");
    await fixture.db.update(schema.usuario).set({ usuarioRol: "dueno" }).where(eq(schema.usuario.usuarioId, users[1]));
    const result = await calendar({ inicioSemana: "2099-01-05" });
    expect(result.turnos[0].puedeModificar).toBe(false);
    expect(await request("turno:editar", { usuarioId: users[0] })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("contexto de trabajador activo de CU28 conserva la asistencia", () => {
  it.each([0, 1])("devuelve todas las opciones activas del contexto de calendario al rol %i", async (index) => {
    const result = await request("trabajador:listar-activos", { contexto: "calendario" }, index);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as AttendanceWorkerOption[]).map((w) => w.trabajadorId)).toEqual([1, 2]);
  });
  it("mantiene el alcance heredado de asistencia e ignora un ID de dueño falsificado", async () => {
    const result = await request("trabajador:listar-activos", { usuarioId: users[0] });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as AttendanceWorkerOption[]).map((w) => w.trabajadorId)).toEqual([2]);
    const owner = await request("trabajador:listar-activos", {}, 0);
    if (!owner.ok) throw new Error(owner.error.message);
    expect(owner.data).toHaveLength(2);
  });
  it.each(["asistencia", "", null, true, {}])("rechaza contexto desconocido %j", async (contexto) => {
    expect(await request("trabajador:listar-activos", { contexto })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
