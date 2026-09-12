import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const currentId = "00000000-0000-4000-8000-000000000411";
const closedId = "00000000-0000-4000-8000-000000000412";
const annulledId = "00000000-0000-4000-8000-000000000413";
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });

  for (const role of ["dueno", "trabajador"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installBridge(page);
    await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/sales-query-harness.html?rol=${role}`);

    await assertInitialState(page);
    await exerciseRangeSearch(page);
    await exerciseDetailAndAnnulmentLink(page);
    await exerciseNumberAndEmptySearch(page);
    if (role === "dueno") await exerciseOutOfOrderResponses(page);

    if (role === "dueno") {
      await page.screenshot({ path: "out/cu41-consulta-ventas.png", fullPage: true });
    }
    assert.deepEqual(pageErrors, []);
    await page.close();
  }

  const restoredPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await installBridge(restoredPage);
  const restoredPath = `/app/ventas/consulta?criterio=rango&fechaInicio=2026-09-10&fechaTermino=2026-09-11&seleccion=${currentId}`;
  await restoredPage.goto(
    `${server.resolvedUrls.local[0]}tests/renderer/sales-query-harness.html?rol=trabajador&path=${encodeURIComponent(restoredPath)}`,
  );
  await restoredPage.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
  assert.equal(await restoredPage.getByLabel("Fecha de inicio").inputValue(), "2026-09-10");
  assert.equal(await restoredPage.getByLabel("Fecha de término").inputValue(), "2026-09-11");
  assert.equal(
    await restoredPage.evaluate(() => window.cu41Calls.filter((call) => call.channel === "venta:buscar").length),
    1,
  );
  await restoredPage.screenshot({ path: "out/cu41-consulta-restaurada.png", fullPage: true });
  await restoredPage.close();
} finally {
  if (browser) await browser.close();
  await server.close();
}

async function installBridge(page) {
  await page.addInitScript(
    ({ currentId, closedId, annulledId }) => {
      window.navigations = [];
      window.cu41Calls = [];
      window.delayClosedSearch = false;

      const sales = [
        {
          ventaId: currentId,
          fechaHora: "2026-09-11T16:00:00.000Z",
          responsable: { usuarioId: "u-1", nombre: "Ana Prueba", rol: "dueno" },
          total: 2700,
          metodoPago: "efectivo",
          estado: "confirmada",
          puedeAnular: true,
        },
        {
          ventaId: closedId,
          fechaHora: "2026-09-11T15:00:00.000Z",
          responsable: { usuarioId: "u-2", nombre: "Luis Cerrado", rol: "trabajador" },
          total: 2000,
          metodoPago: "debito",
          estado: "confirmada",
          puedeAnular: false,
        },
        {
          ventaId: annulledId,
          fechaHora: "2026-09-10T14:00:00.000Z",
          responsable: { usuarioId: "u-1", nombre: "Ana Prueba", rol: "dueno" },
          total: 1000,
          metodoPago: "transferencia",
          estado: "anulada",
          puedeAnular: false,
        },
      ];

      window.appApi = {
        invoke: async (channel, payload) => {
          window.cu41Calls.push({ channel, payload });
          if (channel === "venta:buscar") {
            if (!payload.criterio) {
              return { ok: true, data: { ventaId: payload.ventaId } };
            }
            if (
              window.delayClosedSearch &&
              payload.criterio === "numero" &&
              payload.ventaId === closedId
            ) {
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            const matches =
              payload.criterio === "numero"
                ? sales.filter((sale) => sale.ventaId === payload.ventaId)
                : sales;
            return {
              ok: true,
              data: {
                ventas: matches,
                resumen: {
                  ventasVigentes: matches.filter((sale) => sale.estado === "confirmada").length,
                  montoVigente: matches
                    .filter((sale) => sale.estado === "confirmada")
                    .reduce((sum, sale) => sum + sale.total, 0),
                  ventasAnuladas: matches.filter((sale) => sale.estado === "anulada").length,
                },
              },
            };
          }
          if (channel === "venta:detalle") {
            return {
              ok: true,
              data: {
                ventaId: payload.ventaId,
                fechaHora: "2026-09-11T16:00:00.000Z",
                estado: payload.ventaId === annulledId ? "anulada" : "confirmada",
                responsable: { usuarioId: "u-1", nombre: "Ana Prueba", rol: "dueno" },
                productos: [
                  {
                    productoId: 1,
                    ean13: "7802920000015",
                    nombre: "Leche histórica",
                    cantidad: 3,
                    precioUnitario: 1000,
                    subtotal: 3000,
                  },
                ],
                descuento: { tipo: "porcentaje", valor: 10, razon: "Cliente frecuente" },
                pago: { metodo: "efectivo", montoRecibido: 3000, vuelto: 300 },
                subtotal: 3000,
                total: 2700,
                caja: {
                  cierreCajaId: "00000000-0000-4000-8000-000000000201",
                  estado: "abierta",
                  fechaApertura: "2026-09-11T12:00:00.000Z",
                },
              },
            };
          }
          throw new Error(`Canal inesperado: ${channel}`);
        },
      };
    },
    { currentId, closedId, annulledId },
  );
}

async function assertInitialState(page) {
  await page.getByRole("heading", { name: "Consulta de ventas" }).waitFor();
  assert.equal(await page.getByLabel("Rango de fechas").isChecked(), true);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.equal(await page.getByLabel("Fecha de inicio").inputValue(), today);
  assert.equal(await page.getByLabel("Fecha de término").inputValue(), today);
  assert.equal(await page.evaluate(() => window.cu41Calls.length), 0);
}

async function exerciseRangeSearch(page) {
  await page.getByLabel("Fecha de inicio").fill("2026-09-12");
  await page.getByLabel("Fecha de término").fill("2026-09-11");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByText("La fecha de inicio no puede ser posterior a la fecha de término.").waitFor();
  assert.equal(await page.evaluate(() => window.cu41Calls.length), 0);

  await page.getByLabel("Fecha de inicio").fill("2026-09-10");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("heading", { name: "Resultados" }).waitFor();
  await page.getByText("$ 4.700", { exact: true }).waitFor();
  assert.equal(await page.getByText("Vigente", { exact: true }).count(), 2);
  assert.equal(await page.getByText("Anulada", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Anular" }).count(), 1);
}

async function exerciseDetailAndAnnulmentLink(page) {
  await page.getByRole("button", { name: "Ver detalle" }).first().click();
  await page.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
  await page.getByText("Leche histórica", { exact: true }).waitFor();
  await page.getByText("10% ($ 300)", { exact: true }).waitFor();
  await page.getByText("Cliente frecuente", { exact: true }).waitFor();
  await page.getByText("Monto recibido", { exact: true }).waitFor();
  await page.getByText("Vuelto", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Anular" }).click();
  const navigation = await page.evaluate(() => window.navigations.at(-1));
  const url = new URL(`https://local${navigation}`);
  assert.equal(url.pathname, "/app/ventas/anular");
  assert.equal(url.searchParams.get("ventaId"), currentId);
  assert.match(url.searchParams.get("returnTo"), /^\/app\/ventas\/consulta\?/);

  await page.getByRole("heading", { name: "Anular venta" }).waitFor();
  await page.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
  await page.getByRole("button", { name: "Volver a Consulta de ventas" }).click();
  await page.getByRole("heading", { name: "Resultados" }).waitFor();
  await page.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
}

async function exerciseNumberAndEmptySearch(page) {
  await page.getByLabel("Número de venta").check();
  const input = page.getByLabel("Número de venta", { exact: true }).last();
  await input.fill("venta-invalida");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByText("Ingrese un número de venta válido en formato UUID.").waitFor();

  await input.fill("00000000-0000-4000-8000-000000000499");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByText("No se encontraron ventas para los filtros indicados.").waitFor();
  assert.equal(await page.getByText("$ 0", { exact: true }).count(), 1);
}

async function exerciseOutOfOrderResponses(page) {
  await page.evaluate(
    ({ closedPath, annulledPath }) => {
      window.delayClosedSearch = true;
      window.setCu41Path(closedPath);
      setTimeout(() => window.setCu41Path(annulledPath), 20);
    },
    {
      closedPath: `/app/ventas/consulta?criterio=numero&numero=${closedId}`,
      annulledPath: `/app/ventas/consulta?criterio=numero&numero=${annulledId}`,
    },
  );
  await page.getByText(annulledId, { exact: true }).waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.getByText(closedId, { exact: true }).count(), 0);
}
