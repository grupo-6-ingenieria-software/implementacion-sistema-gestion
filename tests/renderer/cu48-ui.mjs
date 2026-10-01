import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()], esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.requests = [];
    window.mode = "ready";
    window.appApi = { invoke: async (channel, payload) => {
      window.requests.push({ channel, payload });
      if (window.mode === "forbidden") return { ok: false, error: { code: "FORBIDDEN", message: "Acceso denegado" } };
      if (window.mode === "error") throw new Error("Servicio no disponible");
      if (channel !== "reporte:productos-mas-vendidos") return { ok: true, data: { estado: window.mode === "cancelled" ? "cancelled" : "saved" } };
      if (window.mode === "deferred") return new Promise((resolve) => { window.resolvePendingReport = resolve; });
      if (window.mode === "empty") return { ok: true, data: { status: "empty", periodo: payload, totalUnidadesPeriodo: 0, filas: [] } };
      return { ok: true, data: { status: "ready", periodo: payload, totalUnidadesPeriodo: 3, filas: [
        { productoId: 1, ean13: "0000000000001", nombre: "Marraqueta", categoria: "Pan", unidadesVendidas: 2, ingresoNeto: 1800, porcentajeUnidades: 200 / 3 },
        { productoId: 2, ean13: "0000000000002", nombre: "Jugo", categoria: "Bebidas", unidadesVendidas: 1, ingresoNeto: 900, porcentajeUnidades: 100 / 3 },
      ] } };
    } };
  });
  await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/cu48-harness.html`);
  await page.getByLabel("Fecha de inicio").fill("01/09/2026");
  await page.getByLabel("Fecha de término").fill("30/09/2026");
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("Marraqueta").waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { channel: "reporte:productos-mas-vendidos", payload: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" } });
  assert.equal(await page.getByText("66,67 %").count(), 1);
  for (const format of ["pdf", "xlsx"]) {
    await page.getByRole("button", { name: format === "pdf" ? "Exportar PDF" : "Exportar Excel" }).click();
    await page.getByText("Reporte guardado correctamente.").waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { channel: `reporte:exportar-${format}`, payload: { tipo: "productos-mas-vendidos", periodo: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" } } });
  }
  await page.evaluate(() => { window.mode = "deferred"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("Consultando ventas…").waitFor();
  await page.getByLabel("Fecha de inicio").fill("02/09/2026");
  await page.evaluate(() => { window.resolvePendingReport({ ok: true, data: { status: "ready", periodo: { fechaInicio: "2026-09-01", fechaTermino: "2026-09-30" }, totalUnidadesPeriodo: 1, filas: [{ productoId: 99, ean13: "0000000000099", nombre: "Respuesta antigua", categoria: "Pan", unidadesVendidas: 1, ingresoNeto: 100, porcentajeUnidades: 100 }] } }); window.mode = "ready"; });
  assert.equal(await page.getByText("Respuesta antigua").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.getByLabel("Fecha de inicio").fill("02/10/2026");
  assert.equal(await page.getByRole("button", { name: "Exportar PDF" }).count(), 0);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByRole("alert").getByText("La fecha de inicio no puede ser posterior a la fecha de término").waitFor();
  await page.getByLabel("Fecha de inicio").fill("29/02/2026");
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByRole("alert").getByText("Ingrese fechas válidas en formato DD/MM/AAAA.").waitFor();
  await page.getByLabel("Fecha de inicio").fill("01/09/2026");
  await page.evaluate(() => { window.mode = "empty"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("No se encontraron productos vendidos para el período indicado").waitFor();
  assert.equal(await page.getByRole("button", { name: "Exportar Excel" }).count(), 0);
  await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByRole("alert").getByText("No fue posible consultar los productos más vendidos. Intente nuevamente.").waitFor();
  await page.evaluate(() => { window.mode = "forbidden"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.waitForFunction(() => window.lastNavigation === "/app/inicio");
  assert.deepEqual(errors, []);
  console.log("PASS CU48: fechas, tabla, E1, exportación, cambio de filtros, error y acceso denegado.");
} finally {
  await browser?.close();
  await server.close();
}
