import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase } from "../../../src/main/controllers/auth-fixtures";
import { AbsenceError, registerAbsence, type AbsenceActor } from "../../../src/main/controllers/absence-service";
import { AttendanceBusinessError, registerAttendanceEntryWithoutShift } from "../../../src/main/controllers/attendance-service";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";

const NOW = new Date("2026-09-08T15:00:00Z");
const USER = "11111111-1";
const SESSION = "00000000-0000-4000-8000-000000000701";
const actor: AbsenceActor = { usuarioId: USER, sesionId: SESSION, rol: "dueno" };
const request = { trabajadorId: 2, fecha: "2026-09-08", tipo: "justificada" };
const dialect = new SQLiteSyncDialect();
let fixture: AuthTestDatabase;
let database: DbExecutor;

beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  database = fixture.db as unknown as DbExecutor;
  await fixture.client.execute("PRAGMA busy_timeout = 3000");
  await fixture.client.executeMultiple(await readFile("src/db/triggers.sql", "utf8"));
  await seedUser(fixture.db, { usuarioId: USER, trabajadorId: 1, rut: USER, conContrasena: false });
  await seedUser(fixture.db, { usuarioId: "22222222-2", trabajadorId: 2, rut: "22222222-2", rolBd: "trabajador", conContrasena: false });
  await fixture.db.insert(schema.sesionUsuario).values({ sesionUsuarioId: SESSION, usuarioId: USER,
    sesionFechaHoraInicio: NOW.toISOString(), sesionFechaHoraUltimoAcceso: NOW.toISOString(), sesionRolEfectivo: "dueno" });
});
afterEach(async () => { fixture.client.close(); await removeAuthTempDir(fixture.dir); });

const register = (payload: unknown = request, responsible: AbsenceActor | undefined = actor, instant = NOW, executor = database) =>
  registerAbsence(executor, payload, responsible, () => instant);

async function counts() {
  const [row] = await database.all<{ absences: number; logs: number; attendances: number; versions: number }>(sql`
    SELECT (SELECT count(*) FROM ausencia) AS absences,
      (SELECT count(*) FROM log_auditoria) AS logs,
      (SELECT count(*) FROM asistencia) AS attendances,
      (SELECT count(*) FROM usuario_version) AS versions
  `);
  return row;
}
async function absence(tipo: "justificada" | "injustificada" | "licencia" | "vacaciones" | "permiso") {
  await fixture.db.insert(schema.ausencia).values({ ausenciaFecha: request.fecha, ausenciaTipo: tipo, trabajadorId: 2, usuarioRegistradorId: USER });
}
async function attendance(entrada: string, salida: string | null = null) {
  await fixture.db.insert(schema.asistencia).values({ asistenciaFechaHoraEntrada: entrada,
    asistenciaFechaHoraSalida: salida, trabajadorId: 2 });
}
function failWrite(fragment: string, failure: string | Error): DbExecutor {
  return { all: database.all.bind(database), run: database.run.bind(database),
    transaction: (callback) => database.transaction((tx) => callback({
      all: tx.all.bind(tx), transaction: tx.transaction.bind(tx),
      run: async (query: SQL) => {
        if (dialect.sqlToQuery(query).sql.includes(fragment)) throw typeof failure === "string" ? new Error(failure) : failure;
        return tx.run(query);
      },
    })),
  };
}

describe("CU32 registro transaccional de ausencias", () => {
  it.each(["justificada", "injustificada"])("registra ausencia %s sin turno y con identidad confiable", async (tipo) => {
    const result = await register({ ...request, tipo, observacion: "  Motivo  ", usuarioId: "attacker", rol: "dueno" });
    expect(result).toMatchObject({ trabajadorId: 2, trabajadorNombre: "María Huáscar", fecha: request.fecha, tipo, registradoAt: NOW.toISOString() });
    expect(result.ausenciaId).toHaveLength(36);
    const [stored] = await fixture.db.select().from(schema.ausencia);
    expect(stored).toMatchObject({ usuarioRegistradorId: USER, ausenciaObservacion: "Motivo", ausenciaFechaHoraRegistro: NOW.toISOString() });
    const [log] = await fixture.db.select().from(schema.logAuditoria);
    expect(log).toMatchObject({ logTipoAccion: "registrar_ausencia", logModulo: "personal" });
    expect(log.logDescripcion).toContain(request.fecha);
    expect(log.logDescripcion).toContain(tipo);
    const [version] = await fixture.db.select().from(schema.usuarioVersion);
    expect(version.usuarioId).toBe(USER);
    expect(await counts()).toEqual({ absences: 1, logs: 1, attendances: 0, versions: 1 });
  });
  it("almacena una observación opcional vacía como NULL", async () => {
    await register({ ...request, observacion: "  " });
    expect((await fixture.db.select().from(schema.ausencia))[0].ausenciaObservacion).toBeNull();
  });
  it("registra a un trabajador activo existente aun sin cuenta", async () => {
    await fixture.db.insert(schema.trabajador).values({ trabajadorId: 3, trabajadorRut: "33333333-3", trabajadorNombre: "Sin", trabajadorApellido: "Cuenta", trabajadorTelefono: "987654321", trabajadorFechaIngreso: "2026-09-08" });
    await expect(register({ ...request, trabajadorId: 3, fecha: "2024-02-29" })).resolves.toMatchObject({ trabajadorId: 3 });
  });
  it.each(["justificada", "injustificada", "licencia", "vacaciones", "permiso"] as const)("rechaza una ausencia existente de tipo %s", async (tipo) => {
    await absence(tipo);
    await expect(register()).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("ausencia registrada") });
    expect((await counts()).absences).toBe(1);
    expect((await counts()).logs).toBe(0);
  });
  it.each([null, "2026-09-08T22:00:00Z"])("rechaza asistencia abierta o cerrada (%s)", async (salida) => {
    await attendance("2026-09-08T12:00:00Z", salida);
    await expect(register()).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("asistencia") });
    expect((await counts()).absences).toBe(0);
  });
  it("no cuenta un ingreso del día anterior que sale en la fecha solicitada", async () => {
    await attendance("2026-09-08T01:00:00Z", "2026-09-08T05:00:00Z");
    await expect(register()).resolves.toMatchObject({ fecha: request.fecha });
  });
  it.each([
    ["2026-09-08T02:59:59.999Z", false],
    ["2026-09-08T03:00:00.000Z", true],
    ["2026-09-09T02:59:59.999Z", true],
    ["2026-09-09T03:00:00.000Z", false],
  ])("maneja el límite exacto del día %s", async (entrada, conflicts) => {
    await attendance(entrada as string);
    if (conflicts) await expect(register()).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    else await expect(register()).resolves.toBeDefined();
  });
  it.each([
    ["2026-04-04", "2026-04-05T03:30:00Z", true], // Repeated local 23:30, in a 25-hour day.
    ["2026-04-05", "2026-04-05T03:30:00Z", false],
    ["2026-09-06", "2026-09-06T03:59:59Z", false], // Midnight skipped, 23-hour day.
    ["2026-09-06", "2026-09-06T04:00:00Z", true],
  ])("maneja el cambio de horario de Chile el %s para %s", async (fecha, entrada, conflicts) => {
    await attendance(entrada as string);
    const operation = register({ ...request, fecha });
    if (conflicts) await expect(operation).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    else await expect(operation).resolves.toBeDefined();
  });
  it("rechaza un trabajador desconocido sin escrituras", async () => {
    await expect(register({ ...request, trabajadorId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await counts()).toEqual({ absences: 0, logs: 0, attendances: 0, versions: 0 });
  });
  it("vuelve a verificar un trabajador inactivado tras abrir el formulario", async () => {
    await database.run(sql`UPDATE trabajador SET trabajador_estado = 'inactivo' WHERE trabajador_id = 2`);
    await expect(register()).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await counts()).absences).toBe(0);
  });
  it.each([
    { ...request, fecha: "2026-09-09" }, { ...request, tipo: "licencia" },
    { ...request, observacion: "x".repeat(201) }, { ...request, fecha: "2026-02-31" },
  ])("valida entradas del servidor sin escrituras %j", async (payload) => {
    await expect(register(payload)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await counts()).absences).toBe(0);
  });
  it.each(["closed", "expired", "unknown", "different-owner", "worker-role", "inactive-owner", "invalid-timestamp"])("rechaza sesiones %s", async (kind) => {
    let responsible = actor;
    if (kind === "closed") await database.run(sql`UPDATE sesion_usuario SET sesion_fecha_hora_cierre = ${NOW.toISOString()}, sesion_motivo_cierre = 'manual'`);
    if (kind === "expired") await database.run(sql`UPDATE sesion_usuario SET sesion_fecha_hora_ultimo_acceso = '2026-09-08T14:30:00.000Z'`);
    if (kind === "unknown") responsible = { ...actor, sesionId: randomUUID() };
    if (kind === "different-owner") responsible = { ...actor, usuarioId: "22222222-2" };
    if (kind === "worker-role") await database.run(sql`UPDATE sesion_usuario SET sesion_rol_efectivo = 'trabajador'`);
    if (kind === "inactive-owner") await database.run(sql`UPDATE trabajador SET trabajador_estado = 'inactivo' WHERE trabajador_id = 1`);
    if (kind === "invalid-timestamp") await database.run(sql`UPDATE sesion_usuario SET sesion_fecha_hora_ultimo_acceso = 'invalid'`);
    await expect(register(request, responsible)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await counts()).toEqual({ absences: 0, logs: 0, attendances: 0, versions: 0 });
  });
  it("requiere un actor dueno y admite sesiones heredadas sin rol almacenado", async () => {
    await expect(registerAbsence(database, request, undefined)).rejects.toBeInstanceOf(AbsenceError);
    await expect(register(request, { ...actor, rol: "trabajador" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database.run(sql`UPDATE sesion_usuario SET sesion_rol_efectivo = NULL`);
    await expect(register()).resolves.toBeDefined();
  });
  it.each(["INSERT INTO ausencia", "INSERT INTO log_auditoria"])("revierte todas las escrituras si falla %s", async (fragment) => {
    await expect(register(request, actor, NOW, failWrite(fragment, "write failure"))).rejects.toThrow("write failure");
    expect(await counts()).toEqual({ absences: 0, logs: 0, attendances: 0, versions: 0 });
  });
  it("traduce la restricción única de ausencia pero preserva los errores técnicos no relacionados", async () => {
    await expect(register(request, actor, NOW, failWrite("INSERT INTO ausencia", "UNIQUE constraint failed: ausencia.trabajador_id, ausencia.ausencia_fecha"))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(register(request, actor, NOW, failWrite("INSERT INTO ausencia", "UNIQUE constraint failed: otra.columna"))).rejects.toThrow("otra.columna");
    const wrapped = new Error("Failed query", { cause: new Error("UNIQUE constraint failed: ausencia.trabajador_id, ausencia.ausencia_fecha") });
    await expect(register(request, actor, NOW, failWrite("INSERT INTO ausencia", wrapped))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
  it("vuelve a validar el estado del dominio tras SQLITE_BUSY", async () => {
    let attempts = 0;
    const competing: DbExecutor = { ...database, all: database.all.bind(database), run: database.run.bind(database),
      transaction: async (callback) => {
        if (++attempts === 1) { await absence("justificada"); throw Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }); }
        return database.transaction(callback);
      },
    };
    await expect(register(request, actor, NOW, competing)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(attempts).toBe(2);
    expect((await counts()).absences).toBe(1);
  });
  it.each(["absence-first", "attendance-first"])("serializa ausencia frente a asistencia (%s)", async (order) => {
    const otherClient = createClient({ url: `file:${join(fixture.dir, "test.db").replace(/\\/g, "/")}` });
    await otherClient.execute("PRAGMA foreign_keys = ON");
    await otherClient.execute("PRAGMA busy_timeout = 3000");
    const other = drizzle(otherClient, { schema }) as unknown as DbExecutor;
    try {
      const saveAbsence = () => register(request, actor, NOW, database);
      const saveAttendance = () => registerAttendanceEntryWithoutShift(other, { usuarioId: USER, trabajadorRut: "22222222-2", fase: "confirmar" }, NOW);
      const attempts = await Promise.allSettled(order === "absence-first" ? [saveAbsence(), saveAttendance()] : [saveAttendance(), saveAbsence()]);
      expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      const failure = attempts.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") expect(failure.reason instanceof AbsenceError || failure.reason instanceof AttendanceBusinessError).toBe(true);
      const state = await counts();
      expect(Number(state.absences) + Number(state.attendances)).toBe(1);
      expect(state.logs).toBe(1);
    } finally { otherClient.close(); }
  });
  it("serializa dos envíos de ausencia en un solo registro y una sola auditoría", async () => {
    const otherClient = createClient({ url: `file:${join(fixture.dir, "test.db").replace(/\\/g, "/")}` });
    await otherClient.execute("PRAGMA foreign_keys = ON");
    await otherClient.execute("PRAGMA busy_timeout = 3000");
    try {
      const other = drizzle(otherClient, { schema }) as unknown as DbExecutor;
      const attempts = await Promise.allSettled([register(), register(request, actor, NOW, other)]);
      expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      const failure = attempts.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") expect(failure.reason).toMatchObject({ code: "BUSINESS_RULE" });
      expect(await counts()).toEqual({ absences: 1, logs: 1, attendances: 0, versions: 1 });
    } finally { otherClient.close(); }
  });
});
