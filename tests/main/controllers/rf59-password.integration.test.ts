import { randomUUID } from "node:crypto";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { applyTriggers } from "../../../src/db/init";
import { authenticateWithExecutor } from "../../../src/main/controllers/auth-login";
import { authorizeRequest, guardChannel } from "../../../src/main/controllers/auth-guard";
import { signSessionToken, verifySessionToken } from "../../../src/main/controllers/auth-jwt";
import { registerAuditLog } from "../../../src/main/controllers/auth-context";
import { loadCurrentPassword } from "../../../src/main/controllers/current-password";
import {
  changePasswordWithExecutor, resetPasswordWithExecutor, generateTemporaryPassword,
  defaultDeps, type PasswordDeps,
} from "../../../src/main/controllers/password";
import { validateAndRefreshActiveSession } from "../../../src/main/controllers/session";
import { createUserManagementController } from "../../../src/main/controllers/user-management";
import {
  createAuthTestDatabase, removeAuthTempDir, seedUser, type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import { TEMP_PASSWORD_MS, SESSION_INVALIDATED_MESSAGE } from "../../../src/shared/auth";
import { evaluateRouteAccess, resolveInitialRoute } from "../../../src/shared/navigation";

const OWNER = "12345678-9";
const WORKER = "23456789-0";
const NOW = new Date("2026-09-29T15:00:00.000Z");
const ORIGINAL = "Anterior9";
const TEMPORARY = "TmpPass1";
const DEFINITIVE = "Definitiva9";
let fixture: AuthTestDatabase;
const deps: PasswordDeps = { ...defaultDeps, generateTempPassword: () => TEMPORARY, now: () => new Date() };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fixture = await createAuthTestDatabase();
  const hash = await bcrypt.hash(ORIGINAL, 4);
  await seedUser(fixture.db, { usuarioId: OWNER, trabajadorId: 1, rut: OWNER, hash });
  await seedUser(fixture.db, { usuarioId: WORKER, trabajadorId: 2, rut: WORKER,
    rolBd: "trabajador", nombre: "Camila", apellido: "Rojas", hash });
  await applyTriggers(fixture.client, join(process.cwd(), "src/db/triggers.sql"));
});

afterEach(async () => {
  vi.useRealTimers();
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

async function login(usuario = WORKER, contrasena = ORIGINAL) {
  return fixture.db.transaction((tx) => authenticateWithExecutor(tx, schema,
    { usuario, contrasena }, { comparePassword: bcrypt.compare, signToken: signSessionToken, now: () => new Date() }));
}

function reset(usuarioId = OWNER, usuarioObjetivoId = WORKER, sessionRole?: "dueno" | "trabajador") {
  return resetPasswordWithExecutor(fixture.db, schema, { usuarioId, usuarioObjetivoId }, deps, sessionRole);
}

function request(channel: string, token: string, payload = {}) {
  return authorizeRequest(channel, { ...payload, __authToken: token }, undefined, {
    identity: (name, input) => guardChannel(name, input, {
      verifyToken: verifySessionToken,
      audit: (event) => registerAuditLog(fixture.db, schema, event),
    }),
    session: (claims, refresh) => validateAndRefreshActiveSession(fixture.db, schema,
      claims.sesionId, claims.usuarioId, refresh),
    audit: (event) => registerAuditLog(fixture.db, schema, event),
  });
}

describe("RF59 / CU59 / CP63", () => {
  it("generates eight cryptographically random alphanumeric characters", () => {
    const passwords = Array.from({ length: 100 }, generateTemporaryPassword);
    expect(passwords.every((password) => /^[A-Za-z0-9]{8}$/.test(password))).toBe(true);
    expect(new Set(passwords).size).toBe(100);
  });

  it("stores only a bcrypt hash and expires in exactly 24 hours with owner audit identity", async () => {
    expect(await reset()).toMatchObject({ ok: true, data: { contrasenaTemporal: TEMPORARY, usuarioObjetivoId: WORKER } });
    const current = await loadCurrentPassword(fixture.db, schema, WORKER);
    expect(current!.contrasenaHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(TEMPORARY, current!.contrasenaHash)).toBe(true);
    expect(current!.expiracion).toBe(new Date(NOW.getTime() + TEMP_PASSWORD_MS).toISOString());
    const audit = await fixture.db.all(sql`
      SELECT la.log_tipo_accion AS accion, uv.usuario_id AS usuarioId
      FROM log_auditoria la JOIN usuario_version uv USING (usuario_version_id)
    `);
    expect(audit).toEqual([{ accion: "restablecer_password", usuarioId: OWNER }]);
    const stored = JSON.stringify(await fixture.db.select().from(schema.contrasena)) +
      JSON.stringify(await fixture.db.select().from(schema.logAuditoria));
    expect(stored).not.toContain(TEMPORARY);
  });

  it("revokes all target sessions and rejects still-valid JWTs without altering other or already closed sessions", async () => {
    const first = await login();
    const second = await login();
    const owner = await login(OWNER);
    if (!first.ok || !second.ok || !owner.ok) throw new Error("login failed");
    const closedId = randomUUID();
    await fixture.db.insert(schema.sesionUsuario).values({ sesionUsuarioId: closedId, usuarioId: WORKER,
      sesionFechaHoraCierre: "2026-09-28T12:00:00.000Z", sesionMotivoCierre: "manual" });
    expect((await reset()).ok).toBe(true);
    for (const token of [first.data.token, second.data.token]) {
      expect(verifySessionToken(token)).not.toBeNull();
      for (const channel of ["producto:listar", "auth:verificar-sesion", "auth:cambiar-password"]) {
        expect(await request(channel, token)).toMatchObject({ ok: false,
          response: { error: { code: "FORBIDDEN", message: SESSION_INVALIDATED_MESSAGE } } });
      }
    }
    expect((await request("producto:listar", owner.data.token)).ok).toBe(true);
    const sessions = await fixture.db.select().from(schema.sesionUsuario);
    expect(sessions.find((row) => row.sesionUsuarioId === closedId)).toMatchObject({
      sesionFechaHoraCierre: "2026-09-28T12:00:00.000Z", sesionMotivoCierre: "manual" });
    expect(sessions.filter((row) => row.usuarioId === WORKER && row.sesionUsuarioId !== closedId)
      .every((row) => row.sesionMotivoCierre === "sistema" && row.sesionFechaHoraCierre === NOW.toISOString())).toBe(true);
    expect((await login(WORKER, ORIGINAL)).ok).toBe(false);
  });

  it("restricts temporary login to the password view and rejects direct business IPC calls", async () => {
    await reset();
    const response = await login(WORKER, TEMPORARY);
    if (!response.ok) throw new Error("login failed");
    expect(response.data.passwordChangeRequired).toBe(true);
    const state = { isAuthenticated: true, role: response.data.role, passwordChangeRequired: true };
    expect(resolveInitialRoute(state)).toBe("/cambiar-contrasena");
    expect(evaluateRouteAccess("/app/inicio", state)).toMatchObject({ status: "redirect", to: "/cambiar-contrasena" });
    for (const channel of ["producto:listar", "venta:registrar", "access:validate", "auditoria:registrar",
      "auth:restablecer-password", "usuario:solicitar-restablecimiento"]) {
      expect(await request(channel, response.data.token)).toMatchObject({ ok: false,
        response: { error: { code: "FORBIDDEN", message: expect.stringContaining("Debe cambiar") } } });
    }
    for (const channel of ["auth:cambiar-password", "auth:verificar-sesion", "auth:logout"]) {
      expect((await request(channel, response.data.token)).ok).toBe(true);
    }
  });

  it("changes to a definitive password, revokes temporary sessions and unlocks business access only with a new login", async () => {
    await reset();
    const first = await login(WORKER, TEMPORARY);
    const second = await login(WORKER, TEMPORARY);
    if (!first.ok || !second.ok) throw new Error("login failed");
    const guard = await request("auth:cambiar-password", first.data.token,
      { usuarioId: OWNER, contrasenaNueva: DEFINITIVE });
    if (!guard.ok) throw new Error("guard failed");
    expect(await changePasswordWithExecutor(fixture.db, schema, guard.payload, deps))
      .toEqual({ ok: true, data: { cambiada: true } });
    for (const token of [first.data.token, second.data.token]) {
      expect((await request("auth:cambiar-password", token)).ok).toBe(false);
    }
    expect((await login(WORKER, TEMPORARY)).ok).toBe(false);
    const definitive = await login(WORKER, DEFINITIVE);
    if (!definitive.ok) throw new Error("login failed");
    expect(definitive.data.passwordChangeRequired).toBe(false);
    expect((await request("producto:listar", definitive.data.token)).ok).toBe(true);
    const current = await loadCurrentPassword(fixture.db, schema, WORKER);
    expect(current!.esContrasenaTemporal).toBe(false);
    expect(await bcrypt.compare(DEFINITIVE, current!.contrasenaHash)).toBe(true);
  });

  it.each([TEMP_PASSWORD_MS - 1, TEMP_PASSWORD_MS, TEMP_PASSWORD_MS + 1])(
    "enforces the expiration boundary at %i milliseconds", async (elapsed) => {
      await reset();
      vi.setSystemTime(new Date(NOW.getTime() + elapsed));
      const accepted = elapsed < TEMP_PASSWORD_MS;
      expect((await login(WORKER, TEMPORARY)).ok).toBe(accepted);
      expect((await changePasswordWithExecutor(fixture.db, schema,
        { usuarioId: WORKER, contrasenaNueva: DEFINITIVE }, deps)).ok).toBe(accepted);
    });

  it.each([null, "fecha-invalida"])("rejects a missing or malformed expiration (%s)", async (expiration) => {
    await reset();
    const current = await loadCurrentPassword(fixture.db, schema, WORKER);
    if (expiration === null) {
      await fixture.db.delete(schema.contrasenaTemporal).where(eq(schema.contrasenaTemporal.contrasenaId, current!.contrasenaId));
    } else {
      await fixture.db.update(schema.contrasenaTemporal).set({ contrasenaTemporalFechaHoraExpiracion: expiration });
    }
    expect((await login(WORKER, TEMPORARY)).ok).toBe(false);
    expect((await changePasswordWithExecutor(fixture.db, schema,
      { usuarioId: WORKER, contrasenaNueva: DEFINITIVE }, deps)).ok).toBe(false);
  });

  it("keeps sessions and credentials unchanged for invalid, same or weak passwords", async () => {
    await reset();
    const session = await login(WORKER, TEMPORARY);
    if (!session.ok) throw new Error("login failed");
    const before = await fixture.db.select().from(schema.contrasena);
    for (const password of [TEMPORARY, "debil", "", "SinNumeros", "sinmayuscula9"]) {
      expect((await changePasswordWithExecutor(fixture.db, schema,
        { usuarioId: WORKER, contrasenaNueva: password }, deps)).ok).toBe(false);
    }
    expect(await fixture.db.select().from(schema.contrasena)).toEqual(before);
    expect((await request("auth:verificar-sesion", session.data.token)).ok).toBe(true);
  });

  it("invalidates the preceding reset even when two resets have the same timestamp", async () => {
    await reset();
    expect((await resetPasswordWithExecutor(fixture.db, schema,
      { usuarioId: OWNER, usuarioObjetivoId: WORKER }, { ...deps, generateTempPassword: () => "SecondP9" })).ok).toBe(true);
    expect((await login(WORKER, TEMPORARY)).ok).toBe(false);
    expect((await login(WORKER, "SecondP9")).ok).toBe(true);
  });

  it("denies workers, effective worker sessions, inactive owners, missing targets and malformed requests", async () => {
    expect(await reset(WORKER, OWNER)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await reset(OWNER, WORKER, "trabajador")).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await reset(OWNER, "unknown")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await resetPasswordWithExecutor(fixture.db, schema, null, deps)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const worker = await login();
    const owner = await login(OWNER);
    if (!worker.ok || !owner.ok) throw new Error("login failed");
    expect((await request("auth:restablecer-password", worker.data.token, { usuarioId: OWNER })).ok).toBe(false);
    await fixture.db.update(schema.sesionUsuario).set({ sesionRolEfectivo: "trabajador" })
      .where(eq(schema.sesionUsuario.usuarioId, OWNER));
    expect((await request("auth:restablecer-password", owner.data.token)).ok).toBe(false);
    await fixture.db.update(schema.trabajador).set({ trabajadorEstado: "inactivo" }).where(eq(schema.trabajador.trabajadorId, 1));
    expect((await reset()).ok).toBe(false);
    expect((await fixture.db.select().from(schema.contrasena)).length).toBe(2);
  });

  it.each(["expiration", "revocation", "audit"])("rolls back reset if %s persistence fails", async (stage) => {
    await login();
    const statement = stage === "expiration"
      ? "BEFORE INSERT ON contrasena_temporal"
      : stage === "revocation" ? "BEFORE UPDATE ON sesion_usuario" : "BEFORE INSERT ON log_auditoria";
    await fixture.client.execute(`CREATE TRIGGER rf59_failure ${statement} BEGIN SELECT RAISE(ABORT, 'rf59 failure'); END`);
    const passwords = await fixture.db.select().from(schema.contrasena);
    const sessions = await fixture.db.select().from(schema.sesionUsuario);
    const logs = await fixture.db.select().from(schema.logAuditoria);
    expect(await reset()).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    expect(await fixture.db.select().from(schema.contrasena)).toEqual(passwords);
    expect(await fixture.db.select().from(schema.sesionUsuario)).toEqual(sessions);
    expect(await fixture.db.select().from(schema.logAuditoria)).toEqual(logs);
    expect(await fixture.db.select().from(schema.contrasenaTemporal)).toEqual([]);
  });

  it("rolls back a definitive change and session revocation when auditing fails", async () => {
    await reset();
    await login(WORKER, TEMPORARY);
    await fixture.client.execute("CREATE TRIGGER rf59_failure BEFORE INSERT ON log_auditoria BEGIN SELECT RAISE(ABORT, 'rf59 failure'); END");
    const passwords = await fixture.db.select().from(schema.contrasena);
    const sessions = await fixture.db.select().from(schema.sesionUsuario);
    expect(await changePasswordWithExecutor(fixture.db, schema,
      { usuarioId: WORKER, contrasenaNueva: DEFINITIVE }, deps)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    expect(await fixture.db.select().from(schema.contrasena)).toEqual(passwords);
    expect(await fixture.db.select().from(schema.sesionUsuario)).toEqual(sessions);
  });

  it("keeps the legacy user-management reset channel on the same atomic service and trusted role", async () => {
    const requestReset = vi.fn(async (payload, role) => {
      const response = await resetPasswordWithExecutor(fixture.db, schema, payload, deps, role);
      return response.ok ? { ok: true as const, data: { ...response.data, estado: "completado" as const } } : response;
    });
    const controller = createUserManagementController({ authorize: vi.fn(), listUsers: async () => [], requestPasswordReset: requestReset });
    const claims = { usuarioId: OWNER, rol: "trabajador" as const, usuarioRol: "dueno", passwordTemporal: false, sesionId: randomUUID() };
    expect(await controller.handle({ usuarioId: OWNER, usuarioObjetivoId: WORKER },
      { channel: "usuario:solicitar-restablecimiento", claims })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(requestReset).toHaveBeenCalledWith({ usuarioId: OWNER, usuarioObjetivoId: WORKER }, "trabajador");
  });
});
