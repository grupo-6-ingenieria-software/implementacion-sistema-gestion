import assert from "node:assert/strict";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import * as schema from "../../src/db/schema.ts";
import { applyTriggers } from "../../src/db/init.ts";
import { createAuthTestDatabase, removeAuthTempDir, seedUser } from "../../src/main/controllers/auth-fixtures.ts";
import { authenticateWithExecutor } from "../../src/main/controllers/auth-login.ts";
import { authorizeRequest, guardChannel } from "../../src/main/controllers/auth-guard.ts";
import { verifySessionToken, signSessionToken } from "../../src/main/controllers/auth-jwt.ts";
import { registerAuditLog } from "../../src/main/controllers/auth-context.ts";
import { changePasswordWithExecutor, prepareResetWithExecutor, resetPasswordWithExecutor, defaultDeps } from "../../src/main/controllers/password.ts";
import { validateAndRefreshActiveSession, closeSessionWithExecutor } from "../../src/main/controllers/session.ts";

const OWNER = "12345678-9";
const WORKER = "23456789-0";
const ORIGINAL = "Anterior9";
const TEMPORARY = "TmpPass1";
const NEW = "Definitiva9";
const fixture = await createAuthTestDatabase();
const passwordDeps = { ...defaultDeps, generateTempPassword: () => TEMPORARY };
const requests = [];
const pageErrors = [];
const state = { resetFailure: null, changeFailure: false, resetDelay: 0, ownReset: false, eventTiming: "before", holdResponse: false, holdPrepare: false };
let releaseResetResponse;
let releasePreparation;
const pages = [];
async function revokeUser(userId) {
  await Promise.all(pages.map(page => page.evaluate(id => window.rf59Invalidation?.({ usuarioId: id }), userId)));
}
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
let browser;

async function invoke(channel, payload) {
  requests.push({ channel, payload });
  if (channel === "auth:login") {
    return fixture.db.transaction((tx) => authenticateWithExecutor(tx, schema, payload,
      { comparePassword: bcrypt.compare, signToken: signSessionToken, now: () => new Date() }));
  }
  const guard = await authorizeRequest(channel, payload, undefined, {
    identity: (name, input) => guardChannel(name, input, { verifyToken: verifySessionToken,
      audit: (event) => registerAuditLog(fixture.db, schema, event) }),
    session: (claims, refresh) => validateAndRefreshActiveSession(fixture.db, schema,
      claims.sesionId, claims.usuarioId, refresh),
    audit: (event) => registerAuditLog(fixture.db, schema, event),
  });
  if (!guard.ok) return guard.response;
  if (channel === "auth:preparar-restablecimiento") {
    const result = await prepareResetWithExecutor(fixture.db, schema, guard.payload, guard.context.claims.rol);
    if (state.holdPrepare) await new Promise(resolve => { releasePreparation = resolve; });
    return result;
  }
  if (channel === "auth:restablecer-password") {
    if (state.resetFailure === "missing") {
      return resetPasswordWithExecutor(fixture.db, schema, { ...guard.payload, usuarioObjetivoId: "99999999-9" },
        passwordDeps, guard.context.claims.rol);
    }
    if (state.resetFailure === "throw") throw new Error("IPC unavailable");
    if (state.resetFailure === "response") return { ok: false, error: { code: "DATABASE_ERROR", message: "Error al guardar la contraseña" } };
    if (state.resetDelay) await new Promise((resolve) => setTimeout(resolve, state.resetDelay));
    const result = await resetPasswordWithExecutor(fixture.db, schema, guard.payload, passwordDeps, guard.context.claims.rol);
    if (result.ok) {
      if (state.eventTiming === "before") await revokeUser(result.data.usuarioObjetivoId);
      else setTimeout(() => void revokeUser(result.data.usuarioObjetivoId), 100);
      if (state.holdResponse) await new Promise(resolve => { releaseResetResponse = resolve; });
    }
    return result;
  }
  if (channel === "auth:cambiar-password") {
    if (state.changeFailure) throw new Error("IPC unavailable");
    return changePasswordWithExecutor(fixture.db, schema, guard.payload, passwordDeps);
  }
  if (channel === "auth:logout") return closeSessionWithExecutor(fixture.db, schema, guard.context.claims.sesionId);
  if (channel === "auth:verificar-sesion") return { ok: true, data: { active: true } };
  if (channel === "usuario:listar") return { ok: true, data: { users: [{ usuarioId: state.ownReset ? OWNER : WORKER, rut: state.ownReset ? OWNER : WORKER,
    nombreCompleto: state.ownReset ? "María Huáscar" : "Camila Rojas", rol: state.ownReset ? "dueno" : "trabajador", telefono: "987654321", fechaIngreso: "2024-01-01", estado: "activo" }] } };
  // El dashboard no forma parte de RF59; el shell conserva sus menús y manejo de error.
  if (channel === "dashboard:cargar") return { ok: false, error: { code: "DATABASE_ERROR", message: "Dashboard de prueba" } };
  return { ok: true, data: {} };
}

async function installBridge(page) {
  pages.push(page);
  await page.exposeFunction("invokeMain", invoke);
  await page.addInitScript(() => {
    let token = null;
    const setInterval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 60000) window.rf59Heartbeat = callback;
      return setInterval(callback, delay, ...args);
    };
    window.appApi = {
      debugMode: false,
      invoke: (channel, payload = {}) => {
        if (channel === "auth:preparar-restablecimiento") window.rf59PrepareStarted = true;
        return window.invokeMain(channel, { ...payload, __authToken: token }).then(response => {
          if (channel === "auth:restablecer-password") window.rf59ResetDelivered = true;
          if (channel === "auth:preparar-restablecimiento") window.rf59PrepareDelivered = true;
          return response;
        });
      },
      setSessionToken: (value) => { token = value; window.rf59Token = value; },
      onSessionExpired: () => () => {}, onSessionInvalidated: (listener) => { window.rf59Invalidation = listener; return () => { window.rf59Invalidation = null; }; },
      onDashboardUpdated: () => () => {}, onSupplierOrdersUpdated: () => () => {},
    };
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
}

async function login(page, user, password) {
  await page.getByLabel("Usuario", { exact: true }).fill(user);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
}

async function confirmReset(page, accept = true) {
  page.once("dialog", (dialog) => accept ? dialog.accept() : dialog.dismiss());
  await page.getByRole("button", { name: "Restablecer", exact: true }).click();
}

try {
  const hash = await bcrypt.hash(ORIGINAL, 4);
  await seedUser(fixture.db, { usuarioId: OWNER, trabajadorId: 1, rut: OWNER, hash });
  await seedUser(fixture.db, { usuarioId: WORKER, trabajadorId: 2, rut: WORKER,
    nombre: "Camila", apellido: "Rojas", rolBd: "trabajador", hash });
  await applyTriggers(fixture.client, join(process.cwd(), "src/db/triggers.sql"));
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const url = `${server.resolvedUrls.local[0]}tests/renderer/rf59-harness.html#/login`;
  const owner = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const worker = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installBridge(owner);
  await installBridge(worker);
  await owner.goto(url);
  await worker.goto(url);
  await login(owner, OWNER, ORIGINAL);
  await login(worker, WORKER, ORIGINAL);
  await owner.getByRole("button", { name: "Usuarios", exact: true }).click();
  await owner.getByText("Camila Rojas", { exact: true }).waitFor();
  await worker.getByText("Camila Rojas", { exact: true }).waitFor();
  const resetCount = () => requests.filter((row) => row.channel === "auth:restablecer-password").length;
  const prepareCount = () => requests.filter((row) => row.channel === "auth:preparar-restablecimiento").length;
  await confirmReset(owner, false);
  assert.equal(prepareCount(), 1);
  assert.equal(resetCount(), 0);

  state.resetFailure = "missing";
  await confirmReset(owner);
  await owner.getByText("Usuario no encontrado.", { exact: true }).waitFor();
  assert.equal(await owner.getByRole("dialog").count(), 0);
  assert.equal(prepareCount(), 2);
  assert.equal(resetCount(), 1);

  state.resetFailure = "response";
  await confirmReset(owner);
  await owner.getByText("Error al guardar la contraseña", { exact: true }).waitFor();
  state.resetFailure = "throw";
  await confirmReset(owner);
  await owner.getByText("No fue posible restablecer la contraseña. Intente nuevamente.", { exact: true }).waitFor();
  state.resetFailure = null;
  state.resetDelay = 300;
  const beforeReset = resetCount();
  await confirmReset(owner);
  assert.equal(await owner.getByRole("button", { name: "Restablecer", exact: true }).isDisabled(), true);
  await owner.getByRole("dialog").waitFor();
  assert.equal(resetCount(), beforeReset + 1);
  await owner.getByText(TEMPORARY, { exact: true }).waitFor();
  await owner.getByText("Válida por 24 horas. El usuario deberá cambiarla al iniciar sesión.", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Cerrar", exact: true }).click();
  await owner.getByRole("button", { name: "Actualizar", exact: true }).click();
  assert.equal(await owner.getByText(TEMPORARY, { exact: true }).count(), 0);
  await owner.reload();
  await login(owner, OWNER, ORIGINAL);
  await owner.getByRole("button", { name: "Usuarios", exact: true }).click();
  await owner.getByText("Camila Rojas", { exact: true }).waitFor();
  assert.equal(await owner.getByRole("dialog").count(), 0);

  await worker.evaluate(() => window.rf59Heartbeat());
  await worker.getByText("Su sesión fue cerrada por un cambio en su cuenta. Inicie sesión nuevamente.", { exact: true }).waitFor();
  await login(worker, WORKER, ORIGINAL);
  await worker.getByText("Usuario o contraseña incorrectos", { exact: true }).waitFor();
  await login(worker, WORKER, TEMPORARY);
  await worker.getByRole("heading", { name: "Cambio obligatorio de contraseña" }).waitFor();
  await worker.evaluate(() => { location.hash = "/app/admin/usuarios"; });
  await worker.waitForFunction(() => location.hash === "#/cambiar-contrasena");
  const denied = await worker.evaluate(() => window.appApi.invoke("producto:listar"));
  assert.equal(denied.ok, false);

  await worker.getByLabel("Nueva contraseña", { exact: true }).fill(NEW);
  await worker.getByLabel("Confirmar nueva contraseña", { exact: true }).fill("OtraClave9");
  await worker.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
  await worker.getByText("La nueva contraseña y su confirmación no coinciden.", { exact: true }).waitFor();
  await worker.getByLabel("Nueva contraseña", { exact: true }).fill("debil");
  await worker.getByLabel("Confirmar nueva contraseña", { exact: true }).fill("debil");
  await worker.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
  await worker.getByText("La contraseña debe tener al menos 8 caracteres.", { exact: true }).waitFor();
  await worker.getByLabel("Nueva contraseña", { exact: true }).fill(NEW);
  await worker.getByLabel("Confirmar nueva contraseña", { exact: true }).fill(NEW);
  state.changeFailure = true;
  await worker.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
  await worker.getByText("No fue posible cambiar la contraseña. Intente nuevamente.", { exact: true }).waitFor();
  state.changeFailure = false;
  await worker.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
  await worker.getByText("Contraseña cambiada correctamente. Inicie sesión con su nueva contraseña.", { exact: true }).waitFor();
  assert.equal(await worker.evaluate(() => window.rf59Token), null);
  await login(worker, WORKER, TEMPORARY);
  await worker.getByText("Usuario o contraseña incorrectos", { exact: true }).waitFor();
  await login(worker, WORKER, NEW);
  await worker.getByRole("button", { name: "Inicio", exact: true }).waitFor();
  assert.equal((await worker.evaluate(() => window.appApi.invoke("producto:listar"))).ok, true);
  assert.equal(await worker.getByRole("button", { name: "Usuarios", exact: true }).count(), 0);
  state.ownReset = true;
  state.resetDelay = 0;
  for (const timing of ["before", "after"]) {
    state.eventTiming = timing;
    await owner.getByRole("button", { name: "Actualizar", exact: true }).click();
    await owner.getByRole("table").getByText("María Huáscar", { exact: true }).waitFor();
    await confirmReset(owner);
    await owner.waitForFunction(() => location.hash === "#/login");
    await owner.getByRole("dialog").waitFor();
    await owner.getByText(TEMPORARY, { exact: true }).waitFor();
    assert.equal(await owner.evaluate(() => window.rf59Token), null);
    await owner.getByRole("button", { name: "Cerrar", exact: true }).click();
    await login(owner, OWNER, ORIGINAL);
    await owner.getByText("Usuario o contraseña incorrectos", { exact: true }).waitFor();
    await login(owner, OWNER, TEMPORARY);
    await owner.getByRole("heading", { name: "Cambio obligatorio de contraseña" }).waitFor();
    await owner.getByLabel("Nueva contraseña", { exact: true }).fill(ORIGINAL);
    await owner.getByLabel("Confirmar nueva contraseña", { exact: true }).fill(ORIGINAL);
    await owner.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
    await owner.getByRole("button", { name: "Iniciar sesión", exact: true }).waitFor();
    await login(owner, OWNER, ORIGINAL);
    await owner.getByRole("button", { name: "Usuarios", exact: true }).click();
  }
  state.holdPrepare = true;
  const resetsBeforePreparation = resetCount();
  await owner.evaluate(() => { window.rf59PrepareDelivered = false; window.rf59PrepareStarted = false; });
  await owner.getByRole("button", { name: "Restablecer", exact: true }).click();
  await owner.waitForFunction(() => window.rf59PrepareStarted);
  // Espera a que el backend haya preparado la acción antes de cambiar de sesión.
  while (!releasePreparation) await new Promise(resolve => setTimeout(resolve, 20));
  await owner.getByRole("button", { name: "Salir", exact: true }).click();
  await login(owner, WORKER, NEW);
  await owner.getByRole("button", { name: "Inicio", exact: true }).waitFor();
  releasePreparation();
  await owner.waitForFunction(() => window.rf59PrepareDelivered);
  assert.equal(resetCount(), resetsBeforePreparation);
  assert.equal(await owner.getByRole("dialog").count(), 0);
  state.holdPrepare = false;
  await owner.getByRole("button", { name: "Salir", exact: true }).click();
  await login(owner, OWNER, ORIGINAL);
  await owner.getByRole("button", { name: "Usuarios", exact: true }).click();
  await owner.getByRole("button", { name: "Restablecer", exact: true }).waitFor();
  state.eventTiming = "before";
  state.holdResponse = true;
  await owner.evaluate(() => { window.rf59ResetDelivered = false; });
  await confirmReset(owner);
  await owner.waitForFunction(() => location.hash === "#/login");
  await login(owner, WORKER, NEW);
  await owner.getByRole("button", { name: "Inicio", exact: true }).waitFor();
  releaseResetResponse();
  await owner.waitForFunction(() => window.rf59ResetDelivered);
  assert.equal(await owner.getByRole("dialog").count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log("PASS RF59 UI + SQLite: cancelación, E1 usuario no encontrado, errores y reintentos, clave mostrada una vez, revocación de JWT, cambio obligatorio, validaciones y login definitivo");
} finally {
  await browser?.close();
  await server.close();
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
}
