import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({
  configFile: false, root: process.cwd(), esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  await page.addInitScript(() => {
    window.adjustment = { quantity: 20, calls: [], reject: false, refreshFail: false };
    window.appApi = { invoke: async (channel, payload) => {
      const state = window.adjustment;
      state.calls.push({ channel, payload });
      if (channel === "ean:validar-captura") return { ok: true, data: { ean13: payload.value } };
      if (channel === "ean:registrar-fallo") return { ok: true, data: { registrado: true } };
      if (channel === "ajuste:disponibilidad") {
        if (state.refreshFail && state.calls.some(call => call.channel === "ajuste:registrar"))
          return { ok: false, error: { message: "Error al consultar disponibilidad" } };
        return { ok: true, data: { productoId: 1, productoNombre: "Leche", ean13: payload.ean13,
          lots: [{ loteId: "lot-1", cantidadActual: state.quantity, precioCosto: 600, fechaIngreso: "2026-10-03T15:00:00Z" }] } };
      }
      if (channel === "ajuste:registrar") {
        if (state.reject) return { ok: false, error: { message: "Cantidad insuficiente", fieldErrors: { cantidad: "Revise la cantidad" } } };
        state.quantity += payload.cantidad;
        return { ok: true, data: { nuevaCantidadLote: state.quantity } };
      }
      throw new Error("Canal inesperado: " + channel);
    } };
  });
  const open = async () => {
    await page.goto("about:blank");
    await page.goto(server.resolvedUrls.local[0] + "tests/renderer/ean-reader-harness.html?view=adjustment#/app/inventario/ajustes");
    await page.getByPlaceholder("EAN-13").fill("7802920000015");
    await page.getByRole("button", { name: /Cant: 20/ }).click();
    await page.getByLabel(/^Cantidad \(positiva/).fill("3");
    await page.getByLabel(/^Justificacion/).fill("Conteo manual");
  };
  await open();
  await page.getByRole("button", { name: "Registrar ajuste", exact: true }).click();
  await page.getByRole("button", { name: /Cant: 23/ }).waitFor();
  await page.getByText("Ajuste registrado. Nueva cantidad del lote: 23.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel(/^Cantidad \(positiva/).inputValue(), "");
  assert.equal(await page.getByLabel(/^Justificacion/).inputValue(), "");
  assert.ok(await page.getByRole("button", { name: "Registrar ajuste", exact: true }).isDisabled());
  assert.equal(await page.evaluate(() => window.adjustment.calls.filter(call => call.channel === "ajuste:registrar").length), 1);
  await page.getByRole("button", { name: "Reportar lectura fallida", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lectura fallida registrada" }).waitFor();
  assert.ok(await page.getByText("Ajuste registrado. Nueva cantidad del lote: 23.", { exact: true }).isVisible());
  await page.getByPlaceholder("EAN-13").fill("");
  assert.equal(await page.getByText("Ajuste registrado. Nueva cantidad del lote: 23.", { exact: true }).count(), 0);
  console.log("PASS V21 conserva éxito al recargar stock, limpia formulario, evita otra escritura y admite RF62");

  await open();
  await page.evaluate(() => { window.adjustment.reject = true; });
  await page.getByRole("button", { name: "Registrar ajuste", exact: true }).click();
  await page.getByText("Cantidad insuficiente", { exact: true }).waitFor();
  assert.equal(await page.getByLabel(/^Cantidad \(positiva/).inputValue(), "3");
  assert.equal(await page.getByLabel(/^Justificacion/).inputValue(), "Conteo manual");
  assert.ok(await page.getByText("Revise la cantidad", { exact: true }).isVisible());
  assert.equal(await page.evaluate(() => window.adjustment.quantity), 20);
  console.log("PASS V21 conserva datos y stock cuando Main rechaza el ajuste");

  await open();
  await page.evaluate(() => { window.adjustment.refreshFail = true; });
  await page.getByRole("button", { name: "Registrar ajuste", exact: true }).click();
  await page.getByText(/Ajuste registrado.*No se pudo actualizar la disponibilidad.*Error al consultar disponibilidad/).waitFor();
  assert.equal(await page.evaluate(() => window.adjustment.quantity), 23);
  assert.equal(await page.evaluate(() => window.adjustment.calls.filter(call => call.channel === "ajuste:registrar").length), 1);
  console.log("PASS V21 distingue ajuste guardado de fallo en la recarga posterior");
  assert.deepEqual(errors, []);
  console.log("3 grupos de regresión V21 aprobados.");
} finally {
  await browser.close();
  await server.close();
}
