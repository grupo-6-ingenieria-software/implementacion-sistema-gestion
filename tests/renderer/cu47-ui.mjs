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
      if (channel !== "reporte:ventas-mensuales") return { ok: true, data: { estado: window.mode === "cancelled" ? "cancelled" : "saved" } };
      if (window.mode === "empty") return { ok: false, error: { code: "BUSINESS_RULE", message: "No se encontraron ventas para el período indicado" } };
      const dias = Array.from({ length: new Date(payload.anio, payload.mes, 0).getDate() }, (_, index) => ({ fecha: `${payload.anio}-${String(payload.mes).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`, transacciones: index === 0 ? 2 : 0, monto: index === 0 ? 18500 : 0 }));
      return { ok: true, data: { periodo: payload, dias, transacciones: 2, montoTotal: 18500, montoMesAnterior: 0, variacionPorcentual: null, metodos: [{ metodo: "efectivo", transacciones: 1, monto: 8000 }, { metodo: "debito", transacciones: 1, monto: 10500 }, { metodo: "credito", transacciones: 0, monto: 0 }, { metodo: "transferencia", transacciones: 0, monto: 0 }] } };
    } };
  });
  await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/cu47-harness.html`);
  await page.getByLabel("Mes", { exact: true }).selectOption("9");
  await page.getByLabel("Año", { exact: true }).fill("2026");
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("30/09/2026", { exact: true }).waitFor();
  await page.locator(".recharts-bar-rectangle").first().waitFor();
  assert.equal(await page.getByText("N/A", { exact: true }).count(), 1);
  await mkdir("out/cu47-qa", { recursive: true });
  await page.screenshot({ path: "out/cu47-qa/ventas-mensuales.png", fullPage: true });
  for (const format of ["pdf", "xlsx"]) {
    await page.getByRole("button", { name: format === "pdf" ? "Exportar PDF" : "Exportar Excel" }).click();
    await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { channel: `reporte:exportar-${format}`, payload: { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 } } });
  }
  await page.evaluate(() => { window.mode = "cancelled"; });
  await page.getByRole("button", { name: "Exportar PDF" }).click();
  await page.getByText("Exportación cancelada.", { exact: true }).waitFor();
  await page.getByLabel("Mes", { exact: true }).selectOption("2");
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.evaluate(() => { window.mode = "empty"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("No se encontraron ventas para el período indicado", { exact: true }).waitFor();
  assert.equal(await page.locator("table").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Exportar Excel" }).count(), 0);
  await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByRole("alert").waitFor();
  await page.evaluate(() => { window.mode = "ready"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("28/02/2026", { exact: true }).waitFor();
  await page.evaluate(() => { window.mode = "forbidden"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.waitForFunction(() => window.lastNavigation === "/app/inicio");
  assert.deepEqual(errors, []);
  console.log("PASS CU47: consulta, gráfico, días sin ventas, N/A, exportación, cambio de período, E1, reintento y acceso denegado.");
} finally {
  await browser?.close();
  await server.close();
}
