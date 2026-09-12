import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { getWeekStartDateKey, addDaysToDateKey, isoDateToDisplay } from "../../src/shared/shifts";

const server = await createServer({
  configFile: false, root: process.cwd(), plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const systemBrowsers = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? systemBrowsers.find(existsSync),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const url = `${server.resolvedUrls!.local[0]}tests/renderer/cu28-harness.html`;
  const ready = () => page.getByRole("heading", { name: "Calendario semanal de turnos" }).waitFor();
  const card = (name: string) => page.getByRole("button", { name: `${name} 08:00 - 16:00` });

  await page.goto(url);
  await ready();
  assert.equal(await page.getByRole("option").count(), 3);
  assert.equal(await page.getByRole("button", { name: "Crear turno", exact: true }).count(), 0);
  await card("Ana Soto").click();
  await page.getByRole("button", { name: "Cerrar", exact: true }).waitFor();
  assert.equal(await page.locator("input").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Guardar cambios" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Eliminar turno", exact: true }).count(), 0);
  assert.equal(await page.getByText("Este turno ya inicio", { exact: false }).count(), 0);
  assert.ok(await page.getByText(
    `${isoDateToDisplay(getWeekStartDateKey())}, de 08:00 a 16:00.`, { exact: true },
  ).isVisible());
  const output = join(process.cwd(), "out", "cu28-qa");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "trabajador.png"), fullPage: true });

  // Refresh clears an open detail. Filtering can select someone other than the caller.
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.waitForFunction(() => !document.body.textContent?.includes("Actualizando calendario..."));
  assert.equal(await page.getByRole("button", { name: "Cerrar", exact: true }).count(), 0);
  await page.getByRole("combobox").selectOption("1");
  await card("Ana Soto").waitFor();
  assert.equal(await card("Luis Rojas").count(), 0);

  // A selected worker vanishes; preserve name and ID, return an empty calendar.
  await page.evaluate(() => { (window as any).cu28.workers = [(window as any).cu28.workers[1]]; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.getByText("Ana Soto ya no está disponible", { exact: false }).waitFor();
  assert.equal(await page.getByRole("combobox").inputValue(), "1");
  assert.equal(await page.getByRole("option", { name: "Ana Soto (no disponible)" }).count(), 1);
  assert.equal(await page.getByText("Sin turnos", { exact: true }).count(), 7);
  await page.screenshot({ path: join(output, "seleccion-inactiva.png"), fullPage: true });
  await page.getByRole("combobox").selectOption("");
  await card("Luis Rojas").waitFor();

  // Empty week, then a completely empty option list; controls remain available.
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  await page.waitForFunction(() => document.querySelectorAll("select option").length > 0 && document.body.textContent?.includes("Sin turnos"));
  assert.equal(await page.getByText("Sin turnos", { exact: true }).count(), 7);
  await page.evaluate(() => { (window as any).cu28.workers = []; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("select option").length === 1);
  assert.ok(await page.getByRole("button", { name: "Semana anterior" }).isEnabled());

  // Failed refresh is surfaced and retry reloads both resources.
  await page.evaluate(() => { (window as any).cu28.fail = true; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.getByText("Error de prueba CU28", { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).cu28.fail = false; });
  await page.getByRole("button", { name: "Reintentar" }).click();
  await ready();

  // Older refresh finishes after navigation: only the latest week may render.
  await page.goto(url);
  await ready();
  await page.evaluate(() => { (window as any).cu28.hold = true; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  await page.waitForFunction(() => (window as any).cu28.pending.length === 4);
  await page.evaluate(() => { const s = (window as any).cu28; s.pending[2](); s.pending[3](); });
  await ready();
  const next = isoDateToDisplay(addDaysToDateKey(getWeekStartDateKey(), 7));
  await page.getByText(`Semana del ${next}`, { exact: false }).waitFor();
  await page.evaluate(() => { const s = (window as any).cu28; s.pending[0](); s.pending[1](); });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok((await page.locator("body").textContent())?.includes(`Semana del ${next}`));
  assert.equal(await card("Ana Soto").count(), 0);

  // Owner retains create, edit and delete; successful mutations refresh the view.
  await page.goto(`${url}?role=dueno`);
  await ready();
  await card("Ana Soto").click();
  assert.ok(await page.getByRole("button", { name: "Crear turno", exact: true }).isEnabled());
  await page.screenshot({ path: join(output, "dueno.png"), fullPage: true });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.getByText("Turno actualizado correctamente.", { exact: true }).waitFor();
  await card("Ana Soto").click();
  await page.getByRole("button", { name: "Eliminar turno", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar eliminacion", exact: true }).click();
  await page.getByText("Turno eliminado correctamente.", { exact: true }).waitFor();
  const calls = await page.evaluate(() => (window as any).cu28.calls);
  assert.ok(calls.some((c: any) => c.channel === "turno:editar"));
  assert.ok(calls.some((c: any) => c.channel === "turno:eliminar"));
  assert.ok(calls.filter((c: any) => c.channel === "trabajador:listar-activos").every((c: any) => c.payload.contexto === "calendario"));
  assert.deepEqual(errors, []);
  console.log("CU28 UI: consulta por rol, filtros, detalle, refresco, vacío, error/reintento, concurrencia y acciones del dueño OK.");
  console.log(`Capturas: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
