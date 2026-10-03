import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()], esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const systemBrowsers = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
let browser;
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? systemBrowsers.find(existsSync) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, timezoneId: "UTC" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const url = `${server.resolvedUrls!.local[0]}tests/renderer/cu52-harness.html`;
  const path = "/app/reportes/asistencia-personal";
  const result = () => page.getByRole("article", { name: "Reporte generado" });
  const generate = () => page.getByRole("button", { name: "Generar reporte", exact: true });
  const exportPdf = () => page.getByRole("button", { name: "Exportar PDF", exact: true });
  const calls = () => page.evaluate(() => (window as any).cu52.calls.filter((call: any) => call.channel === "reporte:asistencia").length);
  const release = async () => { await page.evaluate(() => { const state = (window as any).cu52; state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve()); }); };
  const open = async (role = "dueno") => {
    await page.goto("about:blank");
    await page.goto(`${url}?role=${role}#/login`);
    await page.getByLabel("Usuario", { exact: true }).fill("11111111-1");
    await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#/app/inicio");
    if (role === "dueno") {
      await page.locator("nav").getByRole("button", { name: "Asistencia del personal", exact: true }).click();
      await page.getByLabel("Mes", { exact: true }).waitFor();
    }
  };
  const choose = async () => { await page.getByLabel("Mes", { exact: true }).selectOption("9"); await page.getByLabel("Año", { exact: true }).fill("2026"); };

  await open();
  const expectedToday = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  assert.equal(await page.getByLabel("Mes", { exact: true }).inputValue(), String(Number(expectedToday.slice(5, 7))));
  assert.equal(await page.getByLabel("Año", { exact: true }).inputValue(), expectedToday.slice(0, 4));
  assert.equal(await page.getByLabel("Rol", { exact: true }).inputValue(), "");
  assert.equal(await result().count(), 0);
  pass("owner menu, Chilean defaults and explicit generation");

  await choose();
  await generate().click();
  await result().waitFor();
  assert.equal(await page.getByRole("columnheader").count(), 7);
  assert.equal(await page.locator("tbody tr").count(), 3);
  assert.equal(await page.getByText("N/A", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Sin usuario", { exact: true }).count(), 1);
  assert.equal(await page.getByText("16:01", { exact: true }).count(), 1);
  assert.equal(await page.getByText("05:20", { exact: true }).count(), 1);
  const output = join(process.cwd(), "out/cu52-qa");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "asistencia-personal.png"), fullPage: true });
  pass("seven columns, missing accounts, N/A and truncated HH:MM values");

  await page.getByLabel("Rol", { exact: true }).selectOption("trabajador");
  assert.equal(await result().count(), 0);
  await generate().click();
  await result().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.getByText("Sin usuario", { exact: true }).count(), 0);
  for (const format of ["pdf", "xlsx"]) {
    await page.getByRole("button", { name: format === "pdf" ? "Exportar PDF" : "Exportar Excel", exact: true }).click();
    await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).cu52.calls.at(-1)), {
      channel: `reporte:exportar-${format}`, payload: { tipo: "asistencia-personal", periodo: { mes: 9, anio: 2026 }, rol: "trabajador" },
    });
  }
  pass("role changes invalidate results and both exports retain queried filters");

  await page.evaluate(() => { (window as any).cu52.cancelled = true; });
  await exportPdf().click();
  await page.getByText("Exportación cancelada.", { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).cu52.exportError = true; });
  await exportPdf().click();
  await page.getByText("No fue posible generar el archivo", { exact: true }).waitFor();
  pass("cancelled and failed exports display their expected result");

  await page.evaluate(() => { Object.assign((window as any).cu52, { exportError: false, cancelled: false, hold: true }); });
  await exportPdf().click();
  await page.waitForFunction(() => (window as any).cu52.pending.length === 1);
  assert.equal(await page.getByLabel("Mes", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Año", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Rol", { exact: true }).isDisabled(), true);
  assert.equal(await generate().isDisabled(), true);
  assert.equal(await exportPdf().isDisabled(), true);
  await release();
  await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
  pass("exports block filters, generation and duplicate exports");

  await page.evaluate(() => { (window as any).cu52.empty = true; });
  await generate().click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 0);
  assert.equal(await page.getByRole("columnheader").count(), 7);
  assert.equal(await exportPdf().isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Exportar Excel", exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(output, "asistencia-vacia.png"), fullPage: true });
  pass("empty report keeps table headings and disables export");

  const beforeInvalid = await calls();
  await page.getByLabel("Año", { exact: true }).fill("1899");
  await generate().click();
  await page.getByText("Seleccione un mes y un año válidos.", { exact: true }).waitFor();
  assert.equal(await calls(), beforeInvalid);
  await page.getByLabel("Año", { exact: true }).fill("9998");
  await generate().click();
  await result().waitFor();
  pass("invalid years stay local and future periods remain selectable");

  await choose();
  await page.evaluate(() => { Object.assign((window as any).cu52, { empty: false, queryError: { code: "BUSINESS_RULE", message: "Luis Rojas: registros inconsistentes en 2026-09-08" } }); });
  await generate().click();
  await page.getByText("Luis Rojas: registros inconsistentes en 2026-09-08", { exact: true }).waitFor();
  assert.equal(await result().count(), 0);
  await page.evaluate(() => { Object.assign((window as any).cu52, { queryError: null, rejectQuery: true }); });
  await generate().click();
  await page.getByText("No fue posible consultar el reporte de asistencia. Intente nuevamente.", { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).cu52.rejectQuery = false; });
  await generate().click();
  await result().waitFor();
  pass("conflicts and transport failures clear results and allow retry");

  const beforeHeld = await calls();
  await page.evaluate(() => { (window as any).cu52.hold = true; });
  await generate().click();
  await page.waitForFunction(() => (window as any).cu52.pending.length === 1);
  await page.locator("form").evaluate((form) => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  assert.equal(await calls(), beforeHeld + 1);
  await page.getByLabel("Mes", { exact: true }).selectOption("10");
  await release();
  assert.equal(await result().count(), 0);
  assert.equal(await generate().isEnabled(), true);
  pass("duplicate submissions are suppressed and filter changes discard delayed successes");

  await page.evaluate(() => { Object.assign((window as any).cu52, { hold: true, rejectQuery: true }); });
  await generate().click();
  await page.waitForFunction(() => (window as any).cu52.pending.length === 1);
  await page.getByLabel("Rol", { exact: true }).selectOption("dueno");
  await release();
  assert.equal(await page.getByRole("alert").count(), 0);
  pass("delayed failures cannot overwrite changed filters");

  await page.evaluate(() => { Object.assign((window as any).cu52, { hold: true, rejectQuery: false }); });
  await generate().click();
  await page.waitForFunction(() => (window as any).cu52.pending.length === 1);
  await page.evaluate(() => { location.hash = "#/app/inicio"; });
  await page.waitForFunction(() => location.hash === "#/app/inicio");
  await release();
  assert.equal(await result().count(), 0);
  pass("leaving the report discards in-flight responses");

  await open();
  await page.evaluate(() => { (window as any).cu52.queryError = { code: "FORBIDDEN", message: "Acceso denegado" }; });
  await generate().click();
  await page.waitForFunction(() => location.hash === "#/app/inicio");
  pass("forbidden queries return to Dashboard");

  await open("trabajador");
  assert.equal(await page.locator("nav").getByRole("button", { name: "Asistencia del personal", exact: true }).count(), 0);
  await page.evaluate((path) => { location.hash = `#${path}`; }, path);
  await page.getByText("No tiene permiso para acceder a este módulo.", { exact: true }).waitFor();
  await page.waitForFunction(() => location.hash === "#/app/inicio");
  assert.equal(await calls(), 0);
  assert.equal(await page.evaluate((path) => (window as any).cu52.calls.filter((call: any) => call.channel === "access:validate" && call.payload.ruta === path).length, path), 1);
  pass("worker direct access redirects and reaches the existing audited access validation");

  await open();
  await page.evaluate(() => { (window as any).cu52.expire(); });
  await page.waitForFunction(() => location.hash === "#/login");
  assert.equal(await result().count(), 0);
  assert.equal(await page.evaluate(() => (window as any).cu52.token), null);
  assert.deepEqual(errors, []);
  pass("session expiry removes the protected view and token");
  console.log(`CU52 UI: ${checks} checks passed. Screenshots: ${output}`);
} finally { await browser?.close(); await server.close(); }
