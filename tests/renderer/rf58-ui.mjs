import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({
  configFile: false, root: process.cwd(), plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.requests = [];
    window.pageErrors = [];
    window.mode = "ready";
    window.addEventListener("error", (event) => window.pageErrors.push(event.message));
    window.appApi = {
      invoke: async (channel, payload) => {
        window.requests.push({ channel, payload });
        if (window.mode === "forbidden") return { ok: false, error: { code: "FORBIDDEN", message: "Acceso denegado" } };
        if (window.mode === "error") return { ok: false, error: { code: "DATABASE_ERROR", message: "No fue posible consultar el log" } };
        const empty = window.mode === "empty";
        const page = payload.page ?? 1;
        return { ok: true, data: {
          entries: empty ? [] : [{
            id: `event-${page}`, fechaHora: "2026-09-29T12:00:00.000-03:00",
            tipoAccion: "edicion", modulo: "inventario", descripcion: `Evento histórico página ${page}`,
            usuarioId: "23456789-0", usuarioNombre: "Camila Rojas", rol: "trabajador",
          }],
          filters: { usuarios: [{ id: "23456789-0", nombre: "Camila Rojas", rol: "trabajador" }], tiposAccion: ["edicion", "registro"] },
          page, pageSize: 25, total: empty ? 0 : 26, totalPages: empty ? 1 : 2,
          periodoConsulta: { desde: "2025-09-29T15:00:00.000Z", hasta: "2026-09-29T15:00:00.000Z" },
        } };
      },
    };
  });
  const rootUrl = server.resolvedUrls?.local[0];
  assert.ok(rootUrl);
  await page.goto(`${rootUrl}tests/renderer/rf58-harness.html`);
  await page.getByText("Evento histórico página 1", { exact: true }).waitFor();
  await page.getByText("Consulta de los últimos 12 meses; los registros son de solo lectura.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /editar|eliminar/i }).count(), 0);
  assert.equal(await page.getByLabel("Fecha desde").getAttribute("min"), "2025-09-29");
  assert.equal(await page.getByLabel("Fecha hasta").getAttribute("max"), "2026-09-29");

  await page.getByLabel("Usuario").selectOption("23456789-0");
  await page.getByLabel("Tipo de accion").selectOption("edicion");
  await page.getByLabel("Fecha desde").fill("2026-09-01");
  await page.getByLabel("Fecha hasta").fill("2026-09-29");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await page.getByText("Evento histórico página 1", { exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.requests.at(-1))).payload, {
    usuarioId: "12345678-9", usuarioFiltroId: "23456789-0", tipoAccion: "edicion",
    fechaDesde: "2026-09-01", fechaHasta: "2026-09-29", page: 1, pageSize: 25,
  });

  // Editar filtros sin consultar no cambia los filtros de la paginación activa.
  await page.getByLabel("Tipo de accion").selectOption("registro");
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await page.getByText("Evento histórico página 2", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.requests.at(-1))).payload.tipoAccion, "edicion");

  await page.evaluate(() => { window.mode = "empty"; });
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.getByText("No se encontraron movimientos para los filtros indicados.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Siguiente", exact: true }).isDisabled(), true);

  await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.getByText("No fue posible consultar el log", { exact: true }).waitFor();
  await page.evaluate(() => { window.mode = "ready"; });
  await page.getByRole("button", { name: "Intentar nuevamente" }).click();
  await page.getByText("Evento histórico página 1", { exact: true }).waitFor();

  await page.evaluate(() => { window.mode = "forbidden"; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.waitForFunction(() => window.lastNavigation === "/app/inicio");
  assert.deepEqual(await page.evaluate(() => window.pageErrors), []);
  console.log("PASS RF58: filtros, paginación, solo lectura, ventana de 12 meses, vacío, reintento y redirección del acceso denegado");
} finally {
  await browser?.close();
  await server.close();
}
