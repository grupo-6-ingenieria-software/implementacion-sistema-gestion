import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { queryMonthlyAttendance } from "../../../src/main/controllers/monthly-attendance-service";
import { listSummaryWorkersWithExecutor } from "../../../src/main/controllers/worker";
import { registerAbsence } from "../../../src/main/controllers/absence-service";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";
import type { MonthlyAttendanceAbsenceType } from "../../../src/shared/monthly-attendance";

let fixture: AuthTestDatabase;
let database: DbExecutor;
const OWNER = "11111111-1";
const SESSION = "00000000-0000-4000-8000-000000000733";
const request = { trabajadorId: 2, mes: 9, anio: 2026 };
const NOW = new Date("2026-09-30T15:00:00Z");
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  database = fixture.db as unknown as DbExecutor;
  await seedUser(fixture.db, { usuarioId: OWNER, trabajadorId: 1, rut: OWNER, nombre: "Ana", apellido: "Soto", conContrasena: false });
  await seedUser(fixture.db, { usuarioId: "22222222-2", trabajadorId: 2, rut: "22222222-2", rolBd: "trabajador", nombre: "Luis", apellido: "Rojas", conContrasena: false });
  await fixture.db.insert(schema.trabajador).values({ trabajadorId: 3, trabajadorRut: "33333333-3", trabajadorNombre: "Inés", trabajadorApellido: "Pérez", trabajadorTelefono: "987654321", trabajadorFechaIngreso: "2024-01-01", trabajadorEstado: "inactivo" });
});
afterEach(async () => { fixture.client.close(); await removeAuthTempDir(fixture.dir); });
const attendance = (entradaAt: string, salidaAt: string | null = null, trabajadorId = 2) => fixture.db.insert(schema.asistencia).values({ trabajadorId, asistenciaFechaHoraEntrada: entradaAt, asistenciaFechaHoraSalida: salidaAt });
const absence = (fecha: string, tipo: MonthlyAttendanceAbsenceType, trabajadorId = 2) => fixture.db.insert(schema.ausencia).values({ trabajadorId, ausenciaFecha: fecha, ausenciaTipo: tipo, usuarioRegistradorId: OWNER });
const query = (input = request) => queryMonthlyAttendance(database, input);

describe("consultas de asistencia mensual CU33 contra libSQL", () => {
  it("combina asistencia y todos los tipos de ausencia, cuenta días pendientes y no modifica los datos del dominio", async () => {
    await attendance("2026-09-01T12:00:45Z", "2026-09-01T20:01:44Z");
    await attendance("2026-09-02T12:00:00Z");
    await attendance("2026-09-03T12:00:00Z", "2026-09-03T20:00:59Z");
    for (const [index, type] of (["justificada", "injustificada", "licencia", "vacaciones", "permiso"] as const).entries()) {
      await absence(`2026-09-${String(index + 7).padStart(2, "0")}`, type);
    }
    await attendance("2026-09-01T12:00:00Z", "2026-09-01T20:00:00Z", 1);
    const snapshot = async () => ({ workers: await fixture.db.select().from(schema.trabajador), attendances: await fixture.db.select().from(schema.asistencia), absences: await fixture.db.select().from(schema.ausencia), logs: await fixture.db.select().from(schema.logAuditoria) });
    const before = await snapshot();
    const report = await query();
    expect(report.dias.map((day) => day.fecha)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(report.dias[1]).toMatchObject({ estado: "pendiente", salidaAt: null, minutosTrabajados: null });
    expect(report.dias.slice(3).every((day) => day.entradaAt === null && day.salidaAt === null && day.minutosTrabajados === null)).toBe(true);
    expect(report.totales).toEqual({ diasTrabajados: 3, minutosTrabajados: 960, ausenciasJustificadas: 4, ausenciasInjustificadas: 1 });
    expect(report.semanas.map((week) => week.minutosTrabajados)).toEqual([960, 0, 0, 0, 0]);
    expect(await snapshot()).toEqual(before);
  });
  it("devuelve un resumen exitoso vacío y cada semana recortada con cero horas", async () => {
    const report = await query();
    expect(report.dias).toEqual([]);
    expect(Object.values(report.totales)).toEqual([0, 0, 0, 0]);
    expect(report.semanas).toEqual([
      { desde: "2026-09-01", hasta: "2026-09-06", minutosTrabajados: 0 },
      { desde: "2026-09-07", hasta: "2026-09-13", minutosTrabajados: 0 },
      { desde: "2026-09-14", hasta: "2026-09-20", minutosTrabajados: 0 },
      { desde: "2026-09-21", hasta: "2026-09-27", minutosTrabajados: 0 },
      { desde: "2026-09-28", hasta: "2026-09-30", minutosTrabajados: 0 },
    ]);
  });
  it("lista y consulta trabajadores inactivos que no tienen cuenta de usuario", async () => {
    expect(await listSummaryWorkersWithExecutor(fixture.db, schema)).toEqual([
      { trabajadorId: 1, rut: OWNER, nombreCompleto: "Ana Soto", estado: "activo" },
      { trabajadorId: 3, rut: "33333333-3", nombreCompleto: "Inés Pérez", estado: "inactivo" },
      { trabajadorId: 2, rut: "22222222-2", nombreCompleto: "Luis Rojas", estado: "activo" },
    ]);
    await attendance("2026-09-08T12:00:00Z", "2026-09-08T20:00:00Z", 3);
    expect(await query({ ...request, trabajadorId: 3 })).toMatchObject({ trabajador: { estado: "inactivo" }, totales: { diasTrabajados: 1, minutosTrabajados: 480 } });
  });
  it("usa fechas de entrada chilenas en ambos límites del mes y excluye el mes siguiente", async () => {
    await attendance("2026-09-01T03:30:00Z", "2026-09-01T03:45:00Z");
    await attendance("2026-09-01T04:00:00Z", "2026-09-01T05:00:00Z");
    await attendance("2026-10-01T02:00:00Z", "2026-10-01T05:00:00Z");
    await attendance("2026-10-01T03:00:00Z", "2026-10-01T04:00:00Z");
    const september = await query();
    expect(september.dias.map((day) => day.fecha)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(september.totales.minutosTrabajados).toBe(240);
    expect(september.semanas.at(-1)?.minutosTrabajados).toBe(180);
    expect((await query({ ...request, mes: 10 })).totales.minutosTrabajados).toBe(60);
  });
  it.each([
    { mes: 9, entrada: "2026-09-06T03:30:00Z", salida: "2026-09-06T05:30:00Z", fecha: "2026-09-05" },
    { mes: 4, entrada: "2026-04-05T02:30:00Z", salida: "2026-04-05T04:30:00Z", fecha: "2026-04-04" },
  ])("usa minutos transcurridos durante el cambio de horario de verano chileno en el mes $mes", async ({ mes, entrada, salida, fecha }) => {
    await attendance(entrada, salida);
    expect((await query({ ...request, mes })).dias).toMatchObject([{ fecha, minutosTrabajados: 120 }]);
  });
  it("preserva la semántica UTC para marcas de tiempo de SQLite y desplazamientos explícitos", async () => {
    await attendance("2026-09-08 12:00:00", "2026-09-08 20:00:00");
    await attendance("2026-09-09T08:00:00-03:00", "2026-09-09T16:00:00-03:00");
    const report = await query();
    expect(report.dias[0]).toMatchObject({ entradaAt: "2026-09-08T12:00:00.000Z", minutosTrabajados: 480 });
    expect(report.dias[1]).toMatchObject({ entradaAt: "2026-09-09T11:00:00.000Z", minutosTrabajados: 480 });
  });
  it("incluye el 29 de febrero y las semanas que comienzan o terminan fuera de un mes bisiesto", async () => {
    await attendance("2024-02-29T12:00:00Z", "2024-02-29T20:00:00Z");
    const report = await query({ ...request, mes: 2, anio: 2024 });
    expect(report.dias[0].fecha).toBe("2024-02-29");
    expect(report.semanas[0]).toMatchObject({ desde: "2024-02-01", hasta: "2024-02-04" });
    expect(report.semanas.at(-1)).toEqual({ desde: "2024-02-26", hasta: "2024-02-29", minutosTrabajados: 480 });
  });
  it.each([1900, 9998])("permite un límite de año futuro/vacío %s", async (anio) => {
    const report = await query({ ...request, mes: 12, anio });
    expect(report.dias).toEqual([]);
    expect(report.semanas.at(-1)?.hasta).toBe(`${anio}-12-31`);
  });
  it("rechaza asistencias duplicadas y conflictos asistencia/ausencia juntos sin devolver totales parciales", async () => {
    await attendance("2026-09-08T12:00:00Z", "2026-09-08T13:00:00Z");
    await attendance("2026-09-08T14:00:00Z", "2026-09-08T15:00:00Z");
    await attendance("2026-09-09T12:00:00Z");
    await absence("2026-09-09", "licencia");
    await expect(query()).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("2026-09-08, 2026-09-09") });
  });
  it.each([
    ["2026-09-08T24:00:00Z", null, "2026-09-08"],
    ["2026-09-31T12:00:00Z", null, "2026-09-31"],
    ["2026-09-08T12:00:00Z", "invalid", "2026-09-08"],
    ["2026-09-08T12:00:00Z", "2026-09-08T11:00:00Z", "2026-09-08"],
    ["invalid", null, "fecha desconocida"],
  ])("rechaza marcas de tiempo inconsistentes %s / %s", async (entrada, salida, fecha) => {
    await fixture.client.execute("PRAGMA ignore_check_constraints = ON");
    await attendance(entrada, salida);
    await fixture.client.execute("PRAGMA ignore_check_constraints = OFF");
    await expect(query()).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining(fecha) });
  });
  it("excluye del resumen las marcas de tiempo claramente corruptas fuera del período solicitado", async () => {
    await attendance("2026-08-08T24:00:00Z");
    expect((await query()).dias).toEqual([]);
  });
  it("informa un trabajador faltante", async () => {
    await expect(query({ ...request, trabajadorId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("refleja una ausencia real registrada por CU32 con su trabajador, fecha y tipo originales", async () => {
    await fixture.db.insert(schema.sesionUsuario).values({ sesionUsuarioId: SESSION, usuarioId: OWNER, sesionFechaHoraInicio: NOW.toISOString(), sesionFechaHoraUltimoAcceso: NOW.toISOString(), sesionRolEfectivo: "dueno" });
    await registerAbsence(database, { trabajadorId: 2, fecha: "2026-09-08", tipo: "justificada" }, { usuarioId: OWNER, sesionId: SESSION, rol: "dueno" }, () => NOW);
    const report = await query();
    expect(report.trabajador.trabajadorId).toBe(2);
    expect(report.dias).toEqual([{ fecha: "2026-09-08", estado: "justificada", entradaAt: null, salidaAt: null, minutosTrabajados: null }]);
    expect(report.totales).toEqual({ diasTrabajados: 0, minutosTrabajados: 0, ausenciasJustificadas: 1, ausenciasInjustificadas: 0 });
    expect(await fixture.db.select().from(schema.logAuditoria)).toHaveLength(1);
    expect((await database.all(sql`SELECT count(*) AS total FROM asistencia`))[0].total).toBe(0);
  });
});
