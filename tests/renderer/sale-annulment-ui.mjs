import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const saleId = "00000000-0000-4000-8000-000000000401";
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
    await page.goto(
      `${server.resolvedUrls.local[0]}tests/renderer/sale-annulment-harness.html?rol=${role}&ventaId=${saleId}`,
    );

    await page.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
    await assertDetail(page);

    if (role === "dueno") {
      await exerciseSearchErrors(page);
      await exerciseSuccessfulAnnulment(page);
      await page.screenshot({ path: "out/cu38-anulacion-confirmada.png", fullPage: true });
    } else {
      await exerciseConcurrentCashClose(page);
      await page.screenshot({ path: "out/cu38-caja-cerrada.png", fullPage: true });
    }

    assert.deepEqual(pageErrors, []);
    await page.close();
  }

  const dailyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await installBridge(dailyPage);
  await dailyPage.goto(
    `${server.resolvedUrls.local[0]}tests/renderer/sale-annulment-harness.html?rol=trabajador&view=daily`,
  );
  await dailyPage.getByRole("heading", { name: "Historial de ventas del dia" }).waitFor();
  await dailyPage.getByRole("button", { name: "Anular" }).click();
  assert.deepEqual(await dailyPage.evaluate(() => window.navigations), [
    `/app/ventas/anular?ventaId=${saleId}`,
  ]);
  assert.equal(await dailyPage.getByText("No disponible", { exact: true }).count(), 1);
  await dailyPage.close();
} finally {
  if (browser) await browser.close();
  await server.close();
}

async function installBridge(page) {
  await page.addInitScript((id) => {
    window.navigations = [];
    window.cu38Calls = [];
    window.lookupMode = "ok";
    window.detailState = "open";
    window.annulMode = "success";

    const detail = () => ({
      ventaId: id,
      fechaHora: "2026-09-11T16:00:00.000Z",
      estado: window.detailState === "annulled" ? "anulada" : "confirmada",
      responsable: { usuarioId: "12345678-9", nombre: "Ana Prueba" },
      productos: [
        {
          productoId: 1,
          ean13: "7802920000015",
          nombre: "Leche",
          cantidad: 3,
          precioUnitario: 1000,
          subtotal: 3000,
        },
      ],
      descuento: { tipo: "monto", valor: 500, razon: "Promoción" },
      pago: { metodo: "efectivo", montoRecibido: 3000, vuelto: 500 },
      subtotal: 3000,
      total: 2500,
      caja: {
        cierreCajaId: "00000000-0000-4000-8000-000000000201",
        estado: window.detailState === "closed" ? "cerrada" : "abierta",
        fechaApertura: "2026-09-11T12:00:00.000Z",
        ...(window.detailState === "closed"
          ? { fechaCierre: "2026-09-11T17:00:00.000Z" }
          : {}),
      },
    });

    window.appApi = {
      invoke: async (channel, payload) => {
        window.cu38Calls.push({ channel, payload });
        if (channel === "venta:historial-dia") {
          return {
            ok: true,
            data: {
              ventas: [
                {
                  ventaId: id,
                  fechaHora: "2026-09-11T16:00:00.000Z",
                  trabajadorResponsable: "Ana Prueba",
                  cantidadProductos: 3,
                  total: 2500,
                  metodoPago: "efectivo",
                  estado: "confirmada",
                },
                {
                  ventaId: "00000000-0000-4000-8000-000000000402",
                  fechaHora: "2026-09-11T15:00:00.000Z",
                  trabajadorResponsable: "Ana Prueba",
                  cantidadProductos: 1,
                  total: 1000,
                  metodoPago: "debito",
                  estado: "anulada",
                },
              ],
              resumen: {
                ventasVigentes: 1,
                montoVigente: 2500,
                porMetodoPago: {
                  efectivo: { cantidadVentas: 1, monto: 2500 },
                  debito: { cantidadVentas: 0, monto: 0 },
                  credito: { cantidadVentas: 0, monto: 0 },
                  transferencia: { cantidadVentas: 0, monto: 0 },
                },
                ventasAnuladas: 1,
                montoAnulado: 1000,
              },
            },
          };
        }
        if (channel === "venta:buscar") {
          if (window.lookupMode === "not-found")
            return { ok: false, error: { code: "NOT_FOUND", message: "La venta indicada no fue encontrada." } };
          if (window.lookupMode === "previous")
            return { ok: false, error: { code: "BUSINESS_RULE", message: "Solo se pueden anular ventas registradas durante el día actual." } };
          if (window.lookupMode === "annulled")
            return { ok: false, error: { code: "BUSINESS_RULE", message: "La venta indicada ya fue anulada." } };
          return { ok: true, data: { ventaId: id } };
        }
        if (channel === "venta:detalle") return { ok: true, data: detail() };
        if (channel === "venta:anular") {
          if (window.annulMode === "closed") {
            window.detailState = "closed";
            return {
              ok: false,
              error: {
                code: "BUSINESS_RULE",
                message: "La caja asociada a la venta está cerrada. No es posible anularla.",
              },
            };
          }
          window.detailState = "annulled";
          return {
            ok: true,
            data: {
              ventaId: id,
              fechaHora: "2026-09-11T17:00:00.000Z",
              razon: payload.razon,
              responsable: { usuarioId: payload.usuarioId, nombre: "Ana Prueba" },
              lotesRestituidos: 2,
              unidadesRestituidas: 3,
            },
          };
        }
        throw new Error(`Canal inesperado: ${channel}`);
      },
    };
  }, saleId);
}

async function assertDetail(page) {
  await page.getByText("Ana Prueba", { exact: true }).waitFor();
  await page.getByText("Leche", { exact: true }).waitFor();
  await page.getByText("7802920000015", { exact: true }).waitFor();
  await page.getByText("$ 2.500", { exact: true }).waitFor();
  await page.getByText("Promoción", { exact: true }).waitFor();
  assert.equal(await page.getByText("Vigente", { exact: true }).count(), 1);
}

async function exerciseSearchErrors(page) {
  const input = page.getByLabel("Número de venta");
  const search = page.getByRole("button", { name: "Buscar venta" });

  await input.fill("venta-invalida");
  await search.click();
  await page.getByText("Ingrese un número de venta válido en formato UUID.").waitFor();

  for (const [mode, message] of [
    ["not-found", "La venta indicada no fue encontrada."],
    ["previous", "Solo se pueden anular ventas registradas durante el día actual."],
    ["annulled", "La venta indicada ya fue anulada."],
  ]) {
    await page.evaluate((nextMode) => (window.lookupMode = nextMode), mode);
    await input.fill(saleId);
    await search.click();
    await page.getByText(message).waitFor();
  }

  await page.evaluate(() => (window.lookupMode = "ok"));
  await input.fill(saleId);
  await search.click();
  await page.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
}

async function exerciseSuccessfulAnnulment(page) {
  const reason = page.getByLabel("Razón de anulación");
  await page.getByRole("button", { name: "Anular venta" }).click();
  await page.getByText("La razón de anulación es obligatoria.").waitFor();

  await reason.fill("  Cliente devolvió la compra  ");
  await page.getByRole("button", { name: "Anular venta" }).click();
  await page.getByText("Confirma que deseas anular esta venta.").waitFor();
  await reason.fill("Cliente devolvió la compra corregida");
  assert.equal(await page.getByText("Confirma que deseas anular esta venta.").count(), 0);

  await page.getByRole("button", { name: "Anular venta" }).click();
  await page.getByRole("button", { name: "Cancelar" }).click();
  assert.equal(await reason.inputValue(), "Cliente devolvió la compra corregida");

  await page.getByRole("button", { name: "Anular venta" }).click();
  await page.getByRole("button", { name: "Confirmar anulación" }).click();
  await page.getByText(/Venta anulada correctamente/).waitFor();
  await page.getByText("Anulada", { exact: true }).waitFor();
  assert.equal(await reason.isDisabled(), true);

  const annulCalls = await page.evaluate(() =>
    window.cu38Calls.filter((call) => call.channel === "venta:anular"),
  );
  assert.equal(annulCalls.length, 1);
  assert.equal(annulCalls[0].payload.razon, "Cliente devolvió la compra corregida");

  await page.getByRole("button", { name: "Volver a Ventas del día" }).click();
  assert.deepEqual(await page.evaluate(() => window.navigations), ["/app/ventas/dia"]);
}

async function exerciseConcurrentCashClose(page) {
  await page.evaluate(() => (window.annulMode = "closed"));
  const reason = page.getByLabel("Razón de anulación");
  await reason.fill("Caja cerrada durante la confirmación");
  await page.getByRole("button", { name: "Anular venta" }).click();
  await page.getByRole("button", { name: "Confirmar anulación" }).click();

  await page.getByText(/La caja asociada a la venta está cerrada/).first().waitFor();
  await page.getByText("Caja asociada", { exact: true }).waitFor();
  assert.equal(await reason.inputValue(), "Caja cerrada durante la confirmación");
  assert.equal(await reason.isDisabled(), true);
  assert.equal(await page.getByText(/Venta anulada correctamente/).count(), 0);
}
