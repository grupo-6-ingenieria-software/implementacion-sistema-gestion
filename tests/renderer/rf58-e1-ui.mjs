import assert from "node:assert/strict";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import * as schema from "../../src/db/schema.ts";
import { applyTriggers } from "../../src/db/init.ts";
import { createAuthTestDatabase, removeAuthTempDir, seedUser } from "../../src/main/controllers/auth-fixtures.ts";
import { authenticateWithExecutor } from "../../src/main/controllers/auth-login.ts";
import { authenticateChannel, authorizeRequest } from "../../src/main/controllers/auth-guard.ts";
import { verifySessionToken, signSessionToken } from "../../src/main/controllers/auth-jwt.ts";
import { registerAuditLog } from "../../src/main/controllers/auth-context.ts";
import { validateAccessWithExecutor } from "../../src/main/controllers/access-control.ts";
import { queryAuditLog } from "../../src/main/controllers/audit-service.ts";
import { validateAndRefreshActiveSession } from "../../src/main/controllers/session.ts";

// CU58-E1: el Trabajador abre el log, Main rechaza auditoria:consultar después
// de validar la sesión, registra un único intento y la vista vuelve al dashboard
// con el aviso. El flujo del Dueño abre el log sin pasar por access:validate.
const OWNER = "12345678-9";
const WORKER = "23456789-0";
const PASSWORD = "Anterior9";
const fixture = await createAuthTestDatabase();
const calls = [];
const pageErrors = [];
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
const audit = (event) => registerAuditLog(fixture.db, schema, event);
let browser;

async function invoke(channel, payload) {
  calls.push({ channel, ruta: payload?.ruta });
  if (channel === "auth:login") {
    return fixture.db.transaction((tx) => authenticateWithExecutor(tx, schema, payload,
      { comparePassword: bcrypt.compare, signToken: signSessionToken, now: () => new Date() }));
  }
  const guard = await authorizeRequest(channel, payload, undefined, {
    identity: (name, input) => authenticateChannel(name, input, { verifyToken: verifySessionToken, audit }),
    session: (claims, refresh) => validateAndRefreshActiveSession(fixture.db, schema,
      claims.sesionId, claims.usuarioId, refresh),
    audit,
  });
  if (!guard.ok) return guard.response;
  if (channel === "access:validate") return validateAccessWithExecutor(fixture.db, schema, guard.payload);
  if (channel === "auditoria:consultar") return queryAuditLog(fixture.db, schema, guard.payload, guard.context.claims.rol);
  if (channel === "auth:verificar-sesion") return { ok: true, data: { active: true } };
  // El dashboard no forma parte de CU58.
  if (channel === "dashboard:cargar") return { ok: false, error: { code: "DATABASE_ERROR", message: "Dashboard de prueba" } };
  return { ok: true, data: {} };
}

async function openApp(user) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.exposeFunction("invokeMain", invoke);
  await page.addInitScript(() => {
    let token = null;
    window.appApi = {
      debugMode: false,
      invoke: (channel, payload = {}) => window.invokeMain(channel, { ...payload, __authToken: token }),
      setSessionToken: (value) => { token = value; },
      onSessionExpired: () => () => {}, onSessionInvalidated: () => () => {},
      onDashboardUpdated: () => () => {}, onSupplierOrdersUpdated: () => () => {},
    };
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/rf59-harness.html#/login`);
  await page.getByLabel("Usuario", { exact: true }).fill(user);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await page.getByRole("button", { name: "Inicio", exact: true }).waitFor();
  return page;
}

const denials = () => fixture.db.all(sql`
  SELECT log_descripcion AS descripcion FROM log_auditoria
  WHERE log_tipo_accion = 'acceso_denegado'`);

try {
  const hash = await bcrypt.hash(PASSWORD, 4);
  await seedUser(fixture.db, { usuarioId: OWNER, trabajadorId: 1, rut: OWNER, hash });
  await seedUser(fixture.db, { usuarioId: WORKER, trabajadorId: 2, rut: WORKER,
    nombre: "Camila", apellido: "Rojas", rolBd: "trabajador", hash });
  await applyTriggers(fixture.client, join(process.cwd(), "src/db/triggers.sql"));
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });

  const worker = await openApp(WORKER);
  assert.equal(await worker.getByRole("button", { name: "Log de auditoria" }).count(), 0);
  calls.length = 0;
  await worker.evaluate(() => { location.hash = "/app/admin/auditoria"; });
  await worker.getByRole("alert").filter({ hasText: "No tiene permiso para realizar esta acción." }).waitFor();
  await worker.waitForFunction(() => location.hash === "#/app/inicio");
  await worker.waitForTimeout(300);
  assert.equal(await worker.getByRole("alert").filter({ hasText: "No tiene permiso" }).count(), 1);
  assert.ok(calls.some((row) => row.channel === "auditoria:consultar"));
  assert.ok(!calls.some((row) => row.channel === "access:validate" && row.ruta === "/app/admin/auditoria"));
  assert.deepEqual(await denials(), [{
    descripcion: "Acceso denegado al canal auditoria:consultar para el rol trabajador.",
  }]);

  const owner = await openApp(OWNER);
  calls.length = 0;
  await owner.getByRole("button", { name: "Log de auditoria" }).click();
  await owner.getByText("Consulta de los últimos 12 meses; los registros son de solo lectura.", { exact: true }).waitFor();
  await owner.getByText("Acceso denegado al canal auditoria:consultar para el rol trabajador.", { exact: true }).waitFor();
  assert.ok(!calls.some((row) => row.channel === "access:validate"));
  assert.deepEqual(pageErrors, []);
  console.log("PASS CU58-E1 UI + SQLite: sesión antes del rol, una denegación auditada, aviso visible y retorno al dashboard");
} finally {
  await browser?.close();
  await server.close();
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
}
