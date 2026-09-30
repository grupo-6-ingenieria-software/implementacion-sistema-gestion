import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const systemBrowsers = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
let browser;
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? systemBrowsers.find(existsSync) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "UTC" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const url = `${server.resolvedUrls!.local[0]}tests/renderer/cu32-harness.html`;
  const formPath = "/app/personal/ausencias/nueva";
  const open = async (path = formPath, role = "dueno") => {
    await page.goto(`${url}?${new URLSearchParams({ path, role })}`);
    if (path.startsWith(formPath) && role === "dueno") {
      try { await page.getByLabel("Trabajador", { exact: true }).waitFor(); }
      catch (error) { console.error("Browser errors:", errors, "Page:", await page.locator("body").innerText()); throw error; }
    }
    else if (path === "/app/personal/trabajadores") await page.getByRole("heading", { name: "Trabajadores", exact: true }).last().waitFor();
  };
  const state = (callback: () => unknown) => page.evaluate(callback);
  const registerButton = () => page.getByRole("button", { name: "Registrar ausencia", exact: true }).last();
  const choose = async (worker = "2") => {
    await page.getByLabel("Trabajador", { exact: true }).selectOption(worker);
    await page.getByLabel("Tipo de ausencia", { exact: true }).selectOption("justificada");
  };

  await open();
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  assert.equal(await page.getByLabel("Fecha de ausencia", { exact: true }).inputValue(), today);
  assert.equal(await page.getByLabel("Tipo de ausencia", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Trabajador", { exact: true }).inputValue(), "");
  await registerButton().click();
  await page.getByText("Seleccione un trabajador válido.", { exact: true }).waitFor();
  assert.equal(await state(() => (window as any).cu32.writes.length), 0);
  pass("defaults use Chile's current date and missing fields prevent submission");

  await page.getByLabel("Buscar trabajador por nombre o RUT", { exact: true }).fill("22.222.222-2");
  assert.equal(await page.getByLabel("Trabajador", { exact: true }).getByRole("option").count(), 2);
  await choose();
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await page.getByLabel("Fecha de ausencia", { exact: true }).fill(tomorrow.toISOString().slice(0, 10));
  await registerButton().click();
  await page.getByText("La fecha de ausencia no puede ser futura.", { exact: true }).waitFor();
  assert.equal(await state(() => (window as any).cu32.writes.length), 0);
  await page.getByLabel("Fecha de ausencia", { exact: true }).fill(today);
  await page.getByLabel("Observación (opcional)", { exact: true }).fill("😀".repeat(200));
  assert.ok(await page.getByText("200/200 caracteres", { exact: true }).isVisible());
  await page.getByLabel("Observación (opcional)", { exact: true }).fill("x".repeat(201));
  assert.ok(await registerButton().isDisabled());
  assert.equal((await page.getByLabel("Observación (opcional)", { exact: true }).inputValue()).length, 201);
  await page.getByLabel("Observación (opcional)", { exact: true }).fill("  Enfermedad con certificado  ");
  pass("search and observation limit preserve oversized text and count Unicode correctly");

  const output = join(process.cwd(), "out", "cu32-qa");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "formulario.png"), fullPage: true });
  await state(() => { (window as any).cu32.hold = true; });
  await registerButton().dblclick();
  assert.ok(await page.getByRole("button", { name: "Registrando..." }).isDisabled());
  assert.equal(await state(() => (window as any).cu32.calls.filter((c: any) => c.channel === "ausencia:registrar").length), 1);
  await state(() => { (window as any).cu32.pending.splice(0).forEach((resolve: () => void) => resolve()); });
  await page.getByText(`Ausencia registrada correctamente para Luis Rojas el ${today.split("-").reverse().join("/")}.`, { exact: true }).waitFor();
  assert.equal(await state(() => (window as any).cu32.navigated), "/app/personal/trabajadores");
  assert.equal(await state(() => (window as any).cu32.writes[0].observacion), "Enfermedad con certificado");
  await page.screenshot({ path: join(output, "registro-exitoso.png"), fullPage: true });
  pass("double click sends one request and success returns to Workers with a transient notice");

  const row = page.getByRole("row").filter({ hasText: "Luis Rojas" });
  await row.getByRole("button", { name: "Registrar ausencia", exact: true }).click();
  await page.getByLabel("Trabajador", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Trabajador", { exact: true }).inputValue(), "2");
  await page.getByLabel("Trabajador", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("heading", { name: "Trabajadores", exact: true }).last().waitFor();
  assert.equal(await page.getByText("Ausencia registrada correctamente", { exact: false }).count(), 0);
  assert.equal(await page.getByRole("row").filter({ hasText: "Inés Pérez" }).getByRole("button", { name: "Registrar ausencia", exact: true }).count(), 0);
  await page.locator("nav").getByRole("button", { name: "Registrar ausencia", exact: true }).click();
  await page.getByLabel("Trabajador", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Trabajador", { exact: true }).inputValue(), "");
  pass("both entries work, preselection is editable and inactive rows have no absence action");

  await open(`${formPath}?trabajadorRut=33333333-3`);
  await page.getByText("El trabajador seleccionado ya no está disponible.", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Trabajador", { exact: true }).inputValue(), "");
  await choose();
  await state(() => { (window as any).cu32.saveError = { code: "BUSINESS_RULE", message: "Trabajador inactivo", fieldErrors: { trabajadorId: "El trabajador está inactivo." } }; });
  await page.getByLabel("Observación (opcional)", { exact: true }).fill("Conservar texto");
  await registerButton().click();
  await page.getByText("El trabajador está inactivo.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Observación (opcional)", { exact: true }).inputValue(), "Conservar texto");
  assert.equal(await state(() => (window as any).cu32.navigated), null);
  await state(() => { (window as any).cu32.saveError = null; (window as any).cu32.rejectSave = true; });
  await registerButton().click();
  await page.getByText("No fue posible confirmar el registro. Intente nuevamente.", { exact: true }).waitFor();
  assert.ok(await registerButton().isEnabled());
  pass("unavailable preselection, domain errors and communication errors preserve the form");

  await open();
  await state(() => { (window as any).cu32.loadError = "Error al cargar trabajadores"; (window as any).cu32.navigate("/app/personal/trabajadores"); });
  await page.locator("nav").getByRole("button", { name: "Registrar ausencia", exact: true }).click();
  await page.getByText("Error al cargar trabajadores", { exact: true }).waitFor();
  await state(() => { (window as any).cu32.loadError = null; (window as any).cu32.workers = []; });
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await page.getByText("No hay trabajadores activos disponibles", { exact: false }).waitFor();
  assert.ok(await registerButton().isDisabled());
  pass("failed loading can be retried and an empty active list cannot submit");

  await open();
  await choose();
  await state(() => { (window as any).cu32.hold = true; });
  await registerButton().click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("heading", { name: "Trabajadores", exact: true }).last().waitFor();
  await state(() => { (window as any).cu32.pending.splice(0).forEach((resolve: () => void) => resolve()); });
  // Returning to the form proves the late response did not inject a success notice.
  await page.locator("nav").getByRole("button", { name: "Registrar ausencia", exact: true }).click();
  await page.getByLabel("Trabajador", { exact: true }).waitFor();
  assert.equal(await page.getByText("Ausencia registrada correctamente", { exact: false }).count(), 0);
  pass("closing the form ignores a late success response");

  await open(formPath, "trabajador");
  await page.getByText("No tiene permiso para acceder a esta vista.", { exact: true }).waitFor();
  assert.equal(await state(() => (window as any).cu32.calls.length), 0);
  await open("/app/personal/trabajadores", "trabajador");
  assert.equal(await page.getByRole("button", { name: "Registrar ausencia", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  pass("worker role has no route, menu or row access");
  console.log(`CU32 UI: ${checks} checks passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
