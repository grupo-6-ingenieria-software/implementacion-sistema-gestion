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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "UTC" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const url = `${server.resolvedUrls!.local[0]}tests/renderer/cu33-harness.html`;
  const summaryPath = "/app/personal/asistencia/resumen-mensual";
  const open = async (path = summaryPath, role = "dueno", extra: Record<string, string> = {}) => {
    await page.goto(`${url}?${new URLSearchParams({ path, role, ...extra })}`);
    if (path.startsWith(summaryPath) && role === "dueno") {
      try { await page.getByLabel("Trabajador", { exact: true }).waitFor(); }
      catch (error) { console.error("Browser errors:", errors, "Page:", await page.locator("body").innerText()); throw error; }
      await page.getByText("Cargando trabajadores...", { exact: true }).waitFor({ state: "hidden" });
    } else if (path === "/app/personal/trabajadores") await page.getByRole("heading", { name: "Trabajadores", exact: true }).last().waitFor();
    else if (path === "/app/personal/asistencia") await page.getByRole("heading", { name: "Registro de asistencia", exact: true }).waitFor();
  };
  const worker = () => page.getByLabel("Trabajador", { exact: true });
  const button = () => page.getByRole("button", { name: "Consultar resumen", exact: true });
  const result = () => page.getByRole("article", { name: "Resumen consultado" });
  const choose = async (id = "2") => { await worker().selectOption(id); await page.getByLabel("Mes", { exact: true }).selectOption("9"); await page.getByLabel("Año", { exact: true }).fill("2026"); };
  const calls = () => page.evaluate(() => (window as any).cu33.calls.filter((call: any) => call.channel === "asistencia:resumen-mensual").length);
  const release = () => page.evaluate(() => (window as any).cu33.pending.splice(0).forEach((resolve: () => void) => resolve()));

  await open();
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  assert.equal(await worker().inputValue(), "");
  assert.equal(await page.getByLabel("Mes", { exact: true }).inputValue(), String(Number(today.slice(5, 7))));
  assert.equal(await page.getByLabel("Año", { exact: true }).inputValue(), today.slice(0, 4));
  assert.equal(await result().count(), 0);
  await button().click();
  await page.getByText("Seleccione un trabajador válido.", { exact: true }).waitFor();
  assert.equal(await calls(), 0);
  await choose();
  await page.getByLabel("Año", { exact: true }).fill("1899");
  await button().click();
  await page.getByText("Seleccione un mes y un año válidos.", { exact: true }).waitFor();
  assert.equal(await calls(), 0);
  pass("Chilean defaults and input validation prevent invalid requests");

  await choose();
  await button().click();
  await result().waitFor();
  assert.equal(await page.getByRole("table", { name: "Detalle diario", exact: true }).locator("tbody tr").count(), 4);
  const pending = page.getByRole("table", { name: "Detalle diario", exact: true }).getByRole("row").filter({ hasText: "02/09/2026" });
  assert.equal(await pending.getByText("Pendiente", { exact: true }).count(), 2);
  const absence = page.getByRole("table", { name: "Detalle diario", exact: true }).getByRole("row").filter({ hasText: "03/09/2026" });
  assert.equal(await absence.getByText("—", { exact: true }).count(), 3);
  assert.ok(await absence.getByText("Licencia", { exact: true }).isVisible());
  assert.ok(await result().getByText("11:00", { exact: true }).isVisible());
  assert.ok(await result().getByText("01/10/2026", { exact: true }).isVisible());
  assert.equal(await page.getByRole("table", { name: "Desglose semanal", exact: true }).locator("tbody tr").count(), 5);
  assert.equal(await page.getByRole("button", { name: /Exportar/ }).count(), 0);
  await page.evaluate(() => (window as any).cu33.rerender());
  assert.equal(await result().count(), 1);
  assert.equal(await page.evaluate(() => (window as any).cu33.calls.filter((call: any) => call.channel === "trabajador:listar-para-resumen").length), 1);
  const output = join(process.cwd(), "out", "cu33-qa");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "resumen-mensual.png"), fullPage: true });
  pass("daily detail, pending values, absence types, overnight dates, totals and weeks render without export controls");

  await page.getByLabel("Mes", { exact: true }).selectOption("10");
  assert.equal(await result().count(), 0);
  await choose("3");
  await page.evaluate(() => { (window as any).cu33.empty = true; });
  await button().click();
  await result().waitFor();
  assert.ok(await result().getByText("Trabajador inactivo", { exact: false }).isVisible());
  assert.equal(await page.getByRole("table", { name: "Detalle diario", exact: true }).locator("tbody tr").count(), 0);
  assert.equal(await page.getByRole("table", { name: "Desglose semanal", exact: true }).getByText("00:00", { exact: true }).count(), 5);
  assert.ok(await result().getByText("No hay registros de asistencia ni ausencia en el período seleccionado.", { exact: true }).isVisible());
  await page.screenshot({ path: join(output, "periodo-vacio.png"), fullPage: true });
  pass("changing filters clears results and inactive workers without accounts have an empty successful summary");

  await open();
  await page.getByLabel("Buscar trabajador por nombre o RUT", { exact: true }).fill("33.333.333-3");
  assert.equal(await worker().getByRole("option").count(), 2);
  await worker().selectOption("3");
  assert.ok(await worker().getByRole("option", { name: /Inés Pérez.*Inactivo/ }).count());
  pass("formatted RUT search includes inactive workers");

  await open(`${summaryPath}?trabajadorRut=33.333.333-3`);
  assert.equal(await worker().inputValue(), "3");
  await worker().selectOption("2");
  assert.equal(await worker().inputValue(), "2");
  await open(`${summaryPath}?trabajadorRut=99999999-9`);
  await page.getByText("El trabajador seleccionado ya no existe. Seleccione otro trabajador.", { exact: true }).waitFor();
  assert.equal(await worker().inputValue(), "");
  pass("preselection is editable and a missing historical worker is reported");

  await open("/app/personal/trabajadores");
  await page.getByRole("row").filter({ hasText: "Pedro Díaz" }).getByRole("button", { name: "Resumen mensual", exact: true }).click();
  await worker().waitFor();
  assert.equal(await worker().inputValue(), "4");
  await page.locator("nav").getByRole("button", { name: "Resumen mensual de asistencia", exact: true }).click();
  await worker().waitFor();
  assert.equal(await worker().inputValue(), "");
  await open("/app/personal/asistencia");
  await page.getByLabel("RUT del trabajador", { exact: true }).fill("22222222-2");
  await page.getByRole("button", { name: "Resumen mensual de asistencia", exact: true }).last().click();
  await worker().waitFor();
  assert.equal(await worker().inputValue(), "2");
  pass("Personal, inactive worker rows and Attendance provide the documented entry points");

  await open();
  await choose();
  await page.evaluate(() => { (window as any).cu33.hold = true; });
  await button().dblclick();
  assert.equal(await calls(), 1);
  assert.ok(await page.getByRole("button", { name: "Consultando...", exact: true }).isDisabled());
  await release();
  await result().waitFor();
  pass("a double click issues one summary request");

  await page.evaluate(() => { (window as any).cu33.hold = true; });
  await button().click();
  await worker().selectOption("3");
  await release();
  assert.equal(await result().count(), 0);
  assert.equal(await worker().inputValue(), "3");
  await page.evaluate(() => { (window as any).cu33.hold = false; });
  await button().click();
  await result().waitFor();
  assert.ok(await result().getByRole("heading", { name: "Inés Pérez", exact: true }).isVisible());
  pass("late successful responses cannot populate another worker's result");

  await open();
  await choose();
  await page.evaluate(() => { (window as any).cu33.queryError = { code: "BUSINESS_RULE", message: "Registros inconsistentes en 2026-09-08." }; });
  await button().click();
  await page.getByText("Registros inconsistentes en 2026-09-08.", { exact: true }).waitFor();
  assert.equal(await result().count(), 0);
  await page.evaluate(() => { (window as any).cu33.queryError = null; (window as any).cu33.rejectQuery = true; (window as any).cu33.hold = true; });
  await button().click();
  await page.getByLabel("Año", { exact: true }).fill("2027");
  await release();
  assert.equal(await page.getByText("No fue posible consultar el resumen de asistencia. Intente nuevamente.", { exact: true }).count(), 0);
  await page.evaluate(() => { (window as any).cu33.hold = false; });
  await choose();
  await button().click();
  await page.getByText("No fue posible consultar el resumen de asistencia. Intente nuevamente.", { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).cu33.rejectQuery = false; });
  await button().click();
  await result().waitFor();
  pass("inconsistencies return no partial totals, communication errors are retryable and stale errors are ignored");

  await open(summaryPath, "dueno", { loadError: "1" });
  await page.getByText("No fue posible cargar los trabajadores.", { exact: true }).waitFor();
  assert.ok(await button().isDisabled());
  await page.evaluate(() => { (window as any).cu33.loadError = false; });
  await page.getByRole("button", { name: "Reintentar carga", exact: true }).click();
  await worker().getByRole("option", { name: /Luis Rojas/ }).waitFor({ state: "attached" });
  assert.ok(await button().isEnabled());
  pass("worker loading errors can be retried");

  await open();
  await choose();
  await page.evaluate(() => { (window as any).cu33.hold = true; });
  await button().click();
  await page.locator("nav").getByRole("button", { name: "Trabajadores", exact: true }).click();
  await page.getByRole("heading", { name: "Trabajadores", exact: true }).last().waitFor();
  await release();
  assert.equal(await result().count(), 0);
  pass("leaving the view discards in-flight results");

  await open(summaryPath, "trabajador");
  await page.getByText("No tiene permiso para acceder a esta vista.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).cu33.calls.length), 0);
  await open("/app/personal/trabajadores", "trabajador");
  assert.equal(await page.getByRole("button", { name: "Resumen mensual", exact: true }).count(), 0);
  assert.equal(await page.locator("nav").getByRole("button", { name: "Resumen mensual de asistencia", exact: true }).count(), 0);
  await open("/app/personal/asistencia", "trabajador");
  assert.equal(await page.getByRole("button", { name: "Resumen mensual de asistencia", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  pass("workers have no route, menu, row or Attendance access to CU33");
  console.log(`CU33 UI: ${checks} checks passed. Screenshots: ${output}`);
} finally { await browser?.close(); await server.close(); }
