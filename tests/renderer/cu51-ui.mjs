import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()], esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.requests = [];
    window.mode = "ready";
    window.appApi = { invoke: async (channel, payload) => {
      window.requests.push({ channel, payload });
      if (window.mode === "forbidden") return { ok: false, error: { code: "FORBIDDEN", message: "Acceso denegado" } };
      if (window.mode === "error") throw new Error("Servicio no disponible");
      if (channel !== "reporte:rentabilidad-categoria") return { ok: true, data: { estado: window.mode === "cancelled" ? "cancelled" : "saved" } };
      if (payload.fechaInicio > payload.fechaTermino) return { ok: false, error: { code: "VALIDATION_ERROR", message: "La fecha de inicio no puede ser posterior a la fecha de término" } };
      return { ok: true, data: { periodo: payload, categorias: window.mode === "empty" ? [] : [
        { categoriaId: 1, categoriaNombre: "Panadería", unidadesVendidas: 2, costoTotal: 60, ingresoNeto: 199, gananciaPorcentual: 231.67 },
        { categoriaId: 2, categoriaNombre: "Bebidas", unidadesVendidas: 1, costoTotal: 80, ingresoNeto: 100, gananciaPorcentual: 25 },
        { categoriaId: 3, categoriaNombre: "Sin costo", unidadesVendidas: 1, costoTotal: 0, ingresoNeto: 100, gananciaPorcentual: null },
      ] } };
    } };
  });
  await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/cu51-harness.html`);
  await page.getByLabel("Fecha de inicio", { exact: true }).fill("2026-09-01");
  await page.getByLabel("Fecha de término", { exact: true }).fill("2026-09-30");
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("231,67 %", { exact: true }).waitFor();
  assert.equal(await page.getByText("25,00 %", { exact: true }).count(), 1);
  assert.equal(await page.getByText("N/A", { exact: true }).count(), 1);
  assert.equal(await page.locator("tbody tr").count(), 3);
  await mkdir("out/cu51-qa", { recursive: true });
  await page.screenshot({ path: "out/cu51-qa/rentabilidad.png", fullPage: true });
  for (const format of ["pdf", "xlsx"]) {
    await page.getByRole("button", { name: format === "pdf" ? "Exportar PDF" : "Exportar Excel" }).click();
    await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), {
      channel: `reporte:exportar-${format}`, payload: { tipo: "rentabilidad-categoria", periodo: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" } },
    });
  }
  await page.evaluate(() => { window.mode = "cancelled"; });
  await page.getByRole("button", { name: "Exportar PDF" }).click();
  await page.getByText("Exportación cancelada.", { exact: true }).waitFor();
  await page.getByLabel("Fecha de inicio", { exact: true }).fill("2026-10-01");
  assert.equal(await page.locator("table").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("La fecha de inicio no puede ser posterior a la fecha de término", { exact: true }).waitFor();
  assert.equal(await page.locator("table").count(), 0);
  await page.getByLabel("Fecha de inicio", { exact: true }).fill("2026-09-01");
  await page.evaluate(() => { window.mode = "empty"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.locator("table").waitFor();
  assert.equal(await page.locator("tbody tr").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Exportar Excel" }).count(), 0);
  await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByRole("alert").waitFor();
  await page.evaluate(() => { window.mode = "ready"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("Panadería", { exact: true }).waitFor();
  await page.evaluate(() => { window.mode = "forbidden"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.waitForFunction(() => window.lastNavigation === "/app/inicio");
  assert.deepEqual(errors, []);
  console.log("PASS CU51: consulta, E1, E2, E3, exportaciones, cancelación, cambio de período, reintento y acceso denegado.");
} finally {
  await browser?.close();
  await server.close();
}
