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
  await page.addInitScript(() => {
    window.reportMode = "data";
    window.calls = [];
    const report = {
      fecha: "2026-06-12", tieneVentas: true,
      ventas: [{ ventaId: "00000000-0000-4000-8000-000000000451", fechaHora: "2026-06-12T17:00:00.000Z", responsable: { usuarioId: "owner", nombre: "Ana Histórica", rol: "dueno" }, estado: "confirmada", metodoPago: "efectivo", total: 2500 }],
      resumen: { ventasVigentes: 1, montoVigente: 2500, porMetodoPago: { efectivo: { cantidad: 1, monto: 2500 }, debito: { cantidad: 0, monto: 0 }, credito: { cantidad: 0, monto: 0 }, transferencia: { cantidad: 0, monto: 0 } }, ventasAnuladas: 1, montoAnulado: 1000 },
      topProductos: [{ productoId: 1, ean13: "7802920000015", nombre: "Pan", unidades: 2, montoNeto: 2500 }],
      caja: { estado: "cerrada", fechaHoraCierre: "2026-06-13T02:00:00.000Z" },
    };
    window.appApi = {
      invoke: async (channel, payload) => {
        window.calls.push({ channel, payload });
        if (channel === "reporte:ventas-diarias") return { ok: true, data: window.reportMode === "empty" ? { ...report, fecha: payload.fecha, tieneVentas: false, ventas: [], topProductos: [] } : { ...report, fecha: payload.fecha } };
        if (channel.startsWith("reporte:exportar-")) return window.reportMode === "error" ? { ok: false, error: { code: "TECHNICAL_ERROR", message: "No fue posible generar el archivo" } } : { ok: true, data: { formato: channel.endsWith("xlsx") ? "xlsx" : "pdf", estado: "saved", ruta: "C:/Documentos/reporte.pdf" } };
        throw new Error(`Canal inesperado: ${channel}`);
      },
    };
  });
  const url = server.resolvedUrls?.local[0]; assert.ok(url);
  await page.goto(`${url}tests/renderer/cu46-harness.html`);
  assert.equal(await page.getByRole("button", { name: "Exportar" }).isDisabled(), true);
  await page.getByLabel("Fecha del reporte").fill("2026-06-12");
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByRole("heading", { name: "Listado de ventas" }).waitFor();
  for (const value of ["Ana Histórica", "Pan", "$2.500", "Cierre:"]) await page.getByText(value, { exact: false }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Exportar" }).isEnabled(), true);
  await page.getByLabel("Formato de exportación").selectOption("xlsx");
  await page.getByRole("button", { name: "Exportar" }).click();
  await page.getByText("Archivo guardado en C:/Documentos/reporte.pdf").waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { channel: "reporte:exportar-xlsx", payload: { tipo: "ventas-diarias", fecha: "2026-06-12" } });
  await page.evaluate(() => { window.reportMode = "error"; });
  await page.getByRole("button", { name: "Exportar" }).click();
  await page.getByText("No fue posible generar el archivo").waitFor();
  await page.evaluate(() => { window.reportMode = "empty"; });
  await page.getByLabel("Fecha del reporte").fill("2026-06-14");
  assert.equal(await page.getByRole("button", { name: "Exportar" }).isDisabled(), true);
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await page.getByText("Sin ventas en la fecha seleccionada").waitFor();
  assert.equal(await page.getByRole("button", { name: "Exportar" }).isDisabled(), true);
  console.log("CU46 UI: flujo, exportación, E1 y E2 verificados");
} finally {
  await browser?.close();
  await server.close();
}
