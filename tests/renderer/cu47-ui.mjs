import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss()], esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) console.error(`${response.status()} ${response.url()}`); });
  await page.addInitScript(() => {
    window.requests = [];
    window.mode = "ready";
    window.operationId = "00000000-0000-4000-8000-000000000054";
    window.appApi = { invoke: async (channel, payload) => {
      window.requests.push({ channel, payload });
      if (window.mode === "forbidden") return { ok: false, error: { code: "FORBIDDEN", message: "Acceso denegado" } };
      if (window.mode === "error") throw new Error("Servicio no disponible");
      if (channel === "reporte:conciliar-exportacion") return { ok: true, data: { operacionId: payload.operacionId, estado: window.mode === "verify-pending" ? "pending" : window.mode === "verify-reverted" ? "reverted" : "saved", exportacion: { estado: "saved" } } };
      if (channel !== "reporte:ventas-mensuales") {
        if (window.mode === "pending") return { ok: false, error: { code: "EXPORT_RECONCILIATION_REQUIRED", message: "No fue posible generar el archivo", operacionId: window.operationId } };
        if (window.mode === "export-error") return { ok: false, error: { code: "TECHNICAL_ERROR", message: "No fue posible generar el archivo" } };
        if (window.mode === "slow") await new Promise((resolve) => setTimeout(resolve, 250));
        return { ok: true, data: { estado: window.mode === "cancelled" ? "cancelled" : "saved" } };
      }
      if (window.mode === "empty") return { ok: false, error: { code: "BUSINESS_RULE", message: "No se encontraron ventas para el período indicado" } };
      const dias = Array.from({ length: new Date(payload.anio, payload.mes, 0).getDate() }, (_, index) => ({ fecha: `${payload.anio}-${String(payload.mes).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`, transacciones: index === 0 ? 2 : 0, monto: index === 0 ? 18500 : 0 }));
      return { ok: true, data: { periodo: payload, dias, transacciones: 2, montoTotal: 18500, montoMesAnterior: 0, variacionPorcentual: null, metodos: [{ metodo: "efectivo", transacciones: 1, monto: 8000 }, { metodo: "debito", transacciones: 1, monto: 10500 }, { metodo: "credito", transacciones: 0, monto: 0 }, { metodo: "transferencia", transacciones: 0, monto: 0 }] } };
    } };
  });
  await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/cu47-harness.html`);
  await page.getByRole("combobox", { name: /^Mes/ }).selectOption("9");
  await page.getByLabel("Año", { exact: true }).fill("2026");
  assert.equal(await page.getByRole("button", { name: "Exportar reporte" }).count(), 0);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("30/09/2026", { exact: true }).waitFor();
  await page.locator(".recharts-bar-rectangle").first().waitFor();
  assert.equal(await page.getByText("N/A", { exact: true }).count(), 1);
  await mkdir("out/cu47-qa", { recursive: true });
  await page.screenshot({ path: "out/cu47-qa/ventas-mensuales.png", fullPage: true });
  async function selectExport(format) {
    await page.getByRole("button", { name: "Exportar reporte", exact: true }).click();
    await page.getByLabel("Formato de exportación").selectOption(format);
  }
  async function exportReport(format) {
    await selectExport(format);
    await page.getByRole("button", { name: "Confirmar exportación", exact: true }).click();
  }
  for (const format of ["pdf", "xlsx"]) {
    await exportReport(format);
    await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { channel: `reporte:exportar-${format}`, payload: { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 } } });
    await page.waitForFunction(() => document.activeElement?.textContent === "Exportar reporte");
  }
  await page.evaluate(() => { window.mode = "cancelled"; });
  await exportReport("pdf");
  await page.getByText("Exportación cancelada.", { exact: true }).waitFor();
  await page.evaluate(() => { window.mode = "slow"; });
  await selectExport("xlsx");
  const exportsBefore = await page.evaluate(() => window.requests.filter((request) => request.channel.startsWith("reporte:exportar-")).length);
  await page.getByRole("button", { name: "Confirmar exportación" }).evaluate((button) => { button.click(); button.click(); });
  await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.requests.filter((request) => request.channel.startsWith("reporte:exportar-")).length), exportsBefore + 1);
  await page.evaluate(() => { window.mode = "export-error"; });
  await exportReport("pdf");
  await page.getByText("No fue posible generar el archivo", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.evaluate(() => { window.mode = "pending"; });
  await exportReport("pdf");
  await page.getByRole("button", { name: "Verificar exportación", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Exportar reporte", exact: true }).isDisabled(), true);
  await page.waitForFunction(() => document.activeElement?.textContent === "Verificar exportación");
  await page.setViewportSize({ width: 540, height: 850 });
  await page.screenshot({ path: "out/cu47-qa/cu54-pendiente.png", fullPage: true });
  await page.evaluate(() => { window.mode = "verify-pending"; });
  await page.getByRole("button", { name: "Verificar exportación" }).click();
  await page.getByText("La exportación sigue pendiente de verificación.", { exact: true }).waitFor();
  await page.evaluate(() => { window.mode = "verify-reverted"; });
  await page.getByRole("button", { name: "Verificar exportación" }).click();
  await page.getByRole("button", { name: "Exportar reporte", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Exportar reporte", exact: true }).isEnabled(), true);
  await page.evaluate(() => { window.mode = "pending"; });
  await exportReport("pdf");
  await page.getByRole("button", { name: "Verificar exportación" }).waitFor();
  await page.evaluate(() => { window.mode = "verify-saved"; });
  await page.getByRole("button", { name: "Verificar exportación" }).click();
  await page.getByText("Reporte guardado correctamente.", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: /^Mes/ }).selectOption("2");
  assert.equal(await page.getByRole("button", { name: "Exportar reporte" }).count(), 0);
  await page.evaluate(() => { window.mode = "empty"; });
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("No se encontraron ventas para el período indicado", { exact: true }).waitFor();
  assert.equal(await page.locator("table").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Exportar reporte" }).count(), 0);
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
  console.log("PASS CU47/CU54: consulta, gráfico, formatos, UI06, doble clic, cancelación, E1, conciliación, foco, cambio de período y acceso denegado.");
} finally {
  await browser?.close();
  await server.close();
}
