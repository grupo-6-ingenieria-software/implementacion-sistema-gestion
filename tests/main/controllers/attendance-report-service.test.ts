import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { queryAttendanceReport } from "../../../src/main/controllers/attendance-report-service";
import { queryMonthlyAttendance } from "../../../src/main/controllers/monthly-attendance-service";
import { registerAbsence } from "../../../src/main/controllers/absence-service";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";
import type { AttendanceReportRequest } from "../../../src/shared/attendance-report";
import type { MonthlyAttendanceAbsenceType } from "../../../src/shared/monthly-attendance";

let fixture: AuthTestDatabase;
let database: DbExecutor;
const OWNER = "11111111-1";
const WORKER = "22222222-2";
const request = { mes: 9, anio: 2026 };
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  database = fixture.db as unknown as DbExecutor;
  await seedUser(fixture.db, { usuarioId: OWNER, trabajadorId: 1, rut: OWNER, nombre: "Ana", apellido: "Soto", conContrasena: false });
  await seedUser(fixture.db, { usuarioId: WORKER, trabajadorId: 2, rut: WORKER, rolBd: "trabajador", nombre: "Luis", apellido: "Rojas", conContrasena: false });
  await fixture.db.insert(schema.trabajador).values([
    { trabajadorId: 3, trabajadorRut: "33333333-3", trabajadorNombre: "Inés", trabajadorApellido: "Pérez", trabajadorTelefono: "987654321", trabajadorFechaIngreso: "2024-01-01", trabajadorEstado: "inactivo" },
    { trabajadorId: 4, trabajadorRut: "44444444-4", trabajadorNombre: "Mario", trabajadorApellido: "Díaz", trabajadorTelefono: "987654321", trabajadorFechaIngreso: "2024-01-01", trabajadorEstado: "activo" },
    { trabajadorId: 5, trabajadorRut: "55555555-5", trabajadorNombre: "Pedro", trabajadorApellido: "Díaz", trabajadorTelefono: "987654321", trabajadorFechaIngreso: "2024-01-01", trabajadorEstado: "inactivo" },
  ]);
});
afterEach(async () => { fixture.client.close(); await removeAuthTempDir(fixture.dir); });
const attendance = (entradaAt: string, salidaAt: string | null = null, trabajadorId = 2) => fixture.db.insert(schema.asistencia).values({ trabajadorId, asistenciaFechaHoraEntrada: entradaAt, asistenciaFechaHoraSalida: salidaAt });
const absence = (fecha: string, tipo: MonthlyAttendanceAbsenceType, trabajadorId = 2) => fixture.db.insert(schema.ausencia).values({ trabajadorId, ausenciaFecha: fecha, ausenciaTipo: tipo, usuarioRegistradorId: OWNER });
const query = (input: AttendanceReportRequest = request) => queryAttendanceReport(database, input);

describe("CU52 monthly report against libSQL", () => {
  it("includes active workers and inactive workers with activity, matches CU33 and truncates averages over worked days", async () => {
    await attendance("2026-09-01T12:00:45Z", "2026-09-01T20:01:44Z");
    await attendance("2026-09-02T12:00:00Z", "2026-09-02T20:01:00Z");
    await attendance("2026-09-03T12:00:00Z");
    await attendance("2026-09-04T12:00:00Z", "2026-09-04T14:00:00Z", 3);
    for (const [index, type] of (["justificada", "injustificada", "licencia", "vacaciones", "permiso"] as const).entries()) {
      await absence(`2026-09-${index + 10}`, type);
    }
    const report = await query();
    expect(report.filas.map((row) => row.trabajadorId)).toEqual([1, 3, 2, 4]);
    const luis = report.filas.find((row) => row.trabajadorId === 2)!;
    expect(luis).toMatchObject({ rol: "trabajador", diasTrabajados: 3, minutosTrabajados: 961, promedioMinutosPorDia: 320, ausenciasJustificadas: 4, ausenciasInjustificadas: 1 });
    const individual = await queryMonthlyAttendance(database, { ...request, trabajadorId: 2 });
    for (const [key, value] of Object.entries(individual.totales)) expect(luis[key as keyof typeof luis]).toBe(value);
    expect(report.filas.find((row) => row.trabajadorId === 3)).toMatchObject({ rol: null, diasTrabajados: 1, promedioMinutosPorDia: 120 });
    expect(report.filas.find((row) => row.trabajadorId === 4)).toMatchObject({ rol: null, diasTrabajados: 0, minutosTrabajados: 0, promedioMinutosPorDia: null });
  });
  it("uses three batched reads within one transaction and leaves source data untouched", async () => {
    await attendance("2026-09-01T12:00:00Z", "2026-09-01T20:00:00Z");
    const snapshot = async () => ({ workers: await fixture.db.select().from(schema.trabajador), users: await fixture.db.select().from(schema.usuario), attendances: await fixture.db.select().from(schema.asistencia), absences: await fixture.db.select().from(schema.ausencia), logs: await fixture.db.select().from(schema.logAuditoria) });
    const before = await snapshot();
    const all = vi.fn();
    const transactions = vi.fn();
    const transaction: DbExecutor["transaction"] = async (callback) => database.transaction((tx) => {
      transactions();
      return callback({ ...tx, all: (statement) => { all(); return tx.all(statement); } });
    });
    await queryAttendanceReport({ transaction }, request);
    expect(transactions).toHaveBeenCalledOnce();
    expect(all).toHaveBeenCalledTimes(3);
    expect(await snapshot()).toEqual(before);
  });
  it("returns an empty table with active workers when the filtered population has no activity", async () => {
    expect((await query()).filas).toEqual([]);
    await attendance("2026-09-01T12:00:00Z");
    expect((await query({ ...request, rol: "dueno" })).filas).toEqual([]);
    expect((await query({ ...request, rol: "trabajador" })).filas.map((row) => row.trabajadorId)).toEqual([2]);
  });
  it("keeps unaccounted workers only under Todos, including absence-only inactive workers", async () => {
    await absence("2026-09-01", "licencia", 3);
    const report = await query();
    expect(report.filas.map((row) => row.trabajadorId)).toEqual([1, 3, 2, 4]);
    expect(report.filas[1]).toMatchObject({ rol: null, diasTrabajados: 0, ausenciasJustificadas: 1, promedioMinutosPorDia: null });
    expect((await query({ ...request, rol: "trabajador" })).filas).toEqual([]);
  });
  it("shows current names with the role in force at the end of the period", async () => {
    await attendance("2026-09-01T12:00:00Z");
    await attendance("2026-10-01T12:00:00Z");
    await fixture.db.insert(schema.usuarioVersion).values([
      { usuarioId: WORKER, usuarioVersionNombre: "Nombre antiguo", usuarioVersionRol: "trabajador", usuarioVersionFechaHoraVigenciaDesde: "2026-01-01 00:00:00", usuarioVersionFechaHoraVigenciaHasta: "2026-10-05T15:00:00.000Z" },
      { usuarioId: WORKER, usuarioVersionNombre: "Luis Rojas", usuarioVersionRol: "dueno", usuarioVersionFechaHoraVigenciaDesde: "2026-10-05T15:00:00.000Z", usuarioVersionFechaHoraVigenciaHasta: null },
    ]);
    await fixture.db.update(schema.usuario).set({ usuarioRol: "dueno" }).where(eq(schema.usuario.usuarioId, WORKER));
    expect((await query()).filas).toEqual(expect.arrayContaining([expect.objectContaining({ trabajadorId: 2, nombreCompleto: "Luis Rojas", rol: "trabajador" })]));
    expect((await query({ ...request, rol: "trabajador" })).filas.map((row) => row.trabajadorId)).toEqual([2]);
    expect((await query({ ...request, rol: "dueno" })).filas.map((row) => row.trabajadorId)).not.toContain(2);
    const october = { mes: 10, anio: 2026 };
    expect((await query({ ...october, rol: "dueno" })).filas).toEqual(expect.arrayContaining([expect.objectContaining({ trabajadorId: 2, rol: "dueno" })]));
    expect((await query({ ...october, rol: "trabajador" })).filas).toEqual([]);
  });
  it("falls back to the oldest known version, then to the current Usuario role", async () => {
    await attendance("2026-09-01T12:00:00Z");
    await fixture.db.update(schema.usuario).set({ usuarioRol: "dueno" }).where(eq(schema.usuario.usuarioId, WORKER));
    expect((await query()).filas.find((row) => row.trabajadorId === 2)?.rol).toBe("dueno");
    await fixture.db.insert(schema.usuarioVersion).values({ usuarioId: WORKER, usuarioVersionNombre: "Luis Rojas", usuarioVersionRol: "trabajador", usuarioVersionFechaHoraVigenciaDesde: "2026-11-01 10:00:00", usuarioVersionFechaHoraVigenciaHasta: null });
    expect((await query()).filas.find((row) => row.trabajadorId === 2)?.rol).toBe("trabajador");
  });
  it("counts pending days as worked days without hours, so their average is zero", async () => {
    await attendance("2026-09-01T12:00:00Z");
    expect((await query()).filas.find((row) => row.trabajadorId === 2)).toMatchObject({ diasTrabajados: 1, minutosTrabajados: 0, promedioMinutosPorDia: 0 });
    await attendance("2026-09-02T12:00:00Z", "2026-09-02T12:00:59Z");
    expect((await query()).filas.find((row) => row.trabajadorId === 2)).toMatchObject({ diasTrabajados: 2, minutosTrabajados: 0, promedioMinutosPorDia: 0 });
  });
  it("attributes complete overnight durations to the Chilean entry month", async () => {
    await attendance("2026-09-01T03:30:00Z", "2026-09-01T03:45:00Z");
    await attendance("2026-09-01T04:00:00Z", "2026-09-01T05:00:00Z");
    await attendance("2026-10-01T02:00:00Z", "2026-10-01T05:00:00Z");
    await attendance("2026-10-01T03:00:00Z", "2026-10-01T04:00:00Z");
    const row = (await query()).filas.find((item) => item.trabajadorId === 2)!;
    expect(row).toMatchObject({ diasTrabajados: 2, minutosTrabajados: 240, promedioMinutosPorDia: 120 });
    expect((await query({ mes: 10, anio: 2026 })).filas.find((item) => item.trabajadorId === 2)?.minutosTrabajados).toBe(60);
  });
  it.each([
    { mes: 9, entrada: "2026-09-06T03:30:00Z", salida: "2026-09-06T05:30:00Z" },
    { mes: 4, entrada: "2026-04-05T02:30:00Z", salida: "2026-04-05T04:30:00Z" },
  ])("uses elapsed minutes over DST in month $mes", async ({ mes, entrada, salida }) => {
    await attendance(entrada, salida);
    expect((await query({ ...request, mes })).filas.find((row) => row.trabajadorId === 2)?.minutosTrabajados).toBe(120);
  });
  it("accepts leap days, legacy UTC timestamps, offsets and year limits", async () => {
    await attendance("2024-02-29 12:00:00", "2024-02-29 20:00:00");
    await attendance("2024-02-28T08:00:00-03:00", "2024-02-28T16:00:00-03:00");
    expect((await query({ mes: 2, anio: 2024 })).filas.find((row) => row.trabajadorId === 2)).toMatchObject({ diasTrabajados: 2, minutosTrabajados: 960 });
    for (const anio of [1900, 9998]) expect((await query({ mes: 12, anio })).filas).toEqual([]);
  });
  it.each(["duplicate", "absence", "inverted", "invalid"])("rejects %s conflicts with worker and date, without partial results", async (conflict) => {
    await attendance("2026-09-01T12:00:00Z", "2026-09-01T20:00:00Z", 1);
    await attendance("2026-09-08T12:00:00Z", "2026-09-08T20:00:00Z");
    if (conflict === "duplicate") await attendance("2026-09-08T21:00:00Z");
    if (conflict === "absence") await absence("2026-09-08", "justificada");
    if (conflict === "invalid") await attendance("2026-09-09T24:00:00Z");
    if (conflict === "inverted") {
      await fixture.client.execute("PRAGMA ignore_check_constraints = ON");
      await attendance("2026-09-09T12:00:00Z", "2026-09-09T11:00:00Z");
      await fixture.client.execute("PRAGMA ignore_check_constraints = OFF");
    }
    await expect(query()).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Luis Rojas (ID 2)") });
    await expect(query()).rejects.toThrow(conflict === "duplicate" || conflict === "absence" ? "2026-09-08" : "2026-09-09");
    expect((await query({ ...request, rol: "dueno" })).filas).toHaveLength(1);
  });
  it("ignores recognizable corruption in another month", async () => {
    await attendance("2026-08-08T24:00:00Z");
    expect((await query()).filas).toEqual([]);
  });
  it("consumes a real CU32 absence without writing a new business record", async () => {
    const sesionId = "00000000-0000-4000-8000-000000000752";
    const now = new Date("2026-09-30T15:00:00Z");
    await fixture.db.insert(schema.sesionUsuario).values({ sesionUsuarioId: sesionId, usuarioId: OWNER, sesionFechaHoraInicio: now.toISOString(), sesionFechaHoraUltimoAcceso: now.toISOString(), sesionRolEfectivo: "dueno" });
    await registerAbsence(database, { trabajadorId: 2, fecha: "2026-09-08", tipo: "justificada" }, { usuarioId: OWNER, sesionId, rol: "dueno" }, () => now);
    expect((await query()).filas.find((row) => row.trabajadorId === 2)).toMatchObject({ ausenciasJustificadas: 1, diasTrabajados: 0, promedioMinutosPorDia: null });
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(1);
    expect(await fixture.db.select().from(schema.ausencia)).toHaveLength(1);
  });
});
