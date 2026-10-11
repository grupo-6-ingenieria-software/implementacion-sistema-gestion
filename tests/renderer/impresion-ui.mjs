// UI: impresión automática al confirmar la venta, falla y reintento,
// reimpresión desde Registrar venta y Consulta de ventas, venta anulada y
// auditoría de desbordes en anchos de pantalla reales.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const vigenteId = "00000000-0000-4000-8000-000000000921";
const anuladaId = "00000000-0000-4000-8000-000000000922";
const WIDTHS = [1024, 1100, 1366, 1536, 1920];

mkdirSync("out", { recursive: true });
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const baseUrl = `${server.resolvedUrls.local[0]}tests/renderer/impresion-harness.html`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });

  await registerSaleFlow(browser);
  await salesQueryFlow(browser);
  console.log("PASS impresión automática, falla y reintento, reimpresión en V12 y V33, venta anulada y sin desbordes en 5 anchos");
} finally {
  if (browser) await browser.close();
  await server.close();
}

async function registerSaleFlow(browser) {
  const page = await newPage(browser);
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Productos activos" }).waitFor();

  await confirmSale(page);
  await page.getByText("Boleta impresa", { exact: true }).waitFor();
  assert.deepEqual(await printCalls(page), [{ ventaId: vigenteId, copia: false }]);

  // Control del detector: un desborde conocido debe fallar la auditoría.
  await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.id = "probe-desborde";
    probe.style.cssText = "display:inline-block;width:4000px";
    probe.textContent = "desborde";
    document.querySelector("section section").appendChild(probe);
  });
  await assert.rejects(auditOverflow(page, "control"), /scroll horizontal de página/);
  await page.evaluate(() => document.getElementById("probe-desborde").remove());

  await page.getByRole("button", { name: "Reimprimir boleta" }).click();
  await page.getByText("Copia de la boleta enviada a la impresora.").waitFor();
  await page.getByText("Copia impresa", { exact: true }).waitFor();
  assert.deepEqual((await printCalls(page)).at(-1), { ventaId: vigenteId, copia: true });
  await auditOverflow(page, "V12 boleta impresa");
  await page.screenshot({ path: "out/impresion-v12-boleta-impresa.png", fullPage: true });

  // La impresora no responde; la venta queda registrada y se reintenta.
  await page.evaluate(() => (window.printMode = "fail"));
  await confirmSale(page);
  await page.getByText("La venta fue registrada. No fue posible imprimir la boleta.", { exact: false }).waitFor();
  await page.getByText("No impresa", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Reimprimir boleta" }).count(), 0);
  await auditOverflow(page, "V12 impresión fallida");
  await page.screenshot({ path: "out/impresion-v12-impresion-fallida.png", fullPage: true });

  await page.evaluate(() => (window.printMode = "ok"));
  await page.getByRole("button", { name: "Reintentar impresión" }).click();
  await page.getByText("Boleta impresa", { exact: true }).waitFor();
  assert.deepEqual((await printCalls(page)).at(-1), { ventaId: vigenteId, copia: false });

  assert.deepEqual(await page.evaluate(() => window.pageErrors), []);
  await page.close();
}

async function salesQueryFlow(browser) {
  const page = await newPage(browser);
  await page.goto(`${baseUrl}?vista=consulta`);
  await page.getByRole("heading", { name: "Consulta de ventas" }).waitFor();
  await page.getByLabel("Fecha de inicio").fill("2026-10-01");
  await page.getByLabel("Fecha de término").fill("2026-10-11");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("heading", { name: "Resultados" }).waitFor();

  // Reimpresión de una venta vigente.
  await page.getByRole("button", { name: "Ver detalle" }).first().click();
  await page.getByRole("heading", { name: "Detalle de la venta" }).waitFor();
  await page.getByRole("button", { name: "Reimprimir boleta" }).click();
  await page.getByText("Copia de la boleta enviada a la impresora.").waitFor();
  assert.deepEqual((await printCalls(page)).at(-1), { ventaId: vigenteId, copia: true });
  await auditOverflow(page, "V33 copia enviada");
  await page.screenshot({ path: "out/impresion-v33-reimpresion.png", fullPage: true });

  // La impresora falla al reimprimir.
  await page.evaluate(() => (window.printMode = "fail"));
  await page.getByRole("button", { name: "Reimprimir boleta" }).click();
  await page.getByText("No fue posible imprimir la boleta.", { exact: false }).waitFor();
  await auditOverflow(page, "V33 reimpresión fallida");

  // Venta anulada, acción deshabilitada y sin llamada a la impresora.
  const callsBefore = (await printCalls(page)).length;
  await page.getByRole("button", { name: "Ver detalle" }).nth(1).click();
  await page.getByRole("article").getByText(anuladaId).waitFor();
  const reprint = page.getByRole("button", { name: "Reimprimir boleta" });
  assert.equal(await reprint.isDisabled(), true);
  assert.equal(await reprint.getAttribute("title"), "No se reimprimen boletas de ventas anuladas");
  assert.equal((await printCalls(page)).length, callsBefore);
  await auditOverflow(page, "V33 venta anulada");
  await page.screenshot({ path: "out/impresion-v33-anulada.png", fullPage: true });

  assert.deepEqual(await page.evaluate(() => window.pageErrors), []);
  await page.close();
}

async function confirmSale(page) {
  await page.getByRole("button", { name: "Sumar" }).click();
  await page.getByRole("button", { name: "Débito" }).click();
  const confirm = page.getByRole("button", { name: "Confirmar venta" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Confirmar venta");
    return button && !button.disabled;
  });
  await confirm.click();
  await page.getByRole("heading", { name: "Comprobante" }).waitFor();
}

async function printCalls(page) {
  return page.evaluate(() =>
    window.calls.filter((call) => call.channel === "boleta:imprimir").map((call) => call.payload),
  );
}

// Elementos fuera de su tarjeta o scroll horizontal, con viewport real.
async function auditOverflow(page, label) {
  const original = page.viewportSize();
  try {
    await checkWidths(page, label);
  } finally {
    await page.setViewportSize(original);
  }
}

async function checkWidths(page, label) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const problems = await page.evaluate(() => {
      const found = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
        found.push("scroll horizontal de página");
      }
      for (const el of document.querySelectorAll("#root *")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const box = el.parentElement?.closest("section, article, aside, dl, div.rounded-md");
        if (!box) continue;
        const b = box.getBoundingClientRect();
        if (r.right > b.right + 1 || r.left < b.left - 1) {
          found.push(`<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 40)}" sale ${Math.round(r.right - b.right)}px`);
        }
      }
      return [...new Set(found)];
    });
    assert.deepEqual(problems, [], `${label} a ${width}px`);
  }
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.addInitScript(
    ({ vigenteId, anuladaId }) => {
      window.calls = [];
      window.pageErrors = [];
      window.printMode = "ok";
      window.addEventListener("error", (event) => window.pageErrors.push(event.message));
      const product = {
        productoId: 1,
        ean13: "7802920000015",
        nombre: "Pan amasado",
        categoria: "Panadería",
        precioVenta: 1000,
        stockDisponible: 10,
      };
      const detail = (ventaId) => ({
        ventaId,
        fechaHora: "2026-10-11T16:00:00.000Z",
        estado: ventaId === anuladaId ? "anulada" : "confirmada",
        responsable: { usuarioId: "12345678-9", nombre: "Ana Prueba", rol: "trabajador" },
        productos: [{ productoId: 1, ean13: product.ean13, nombre: product.nombre, cantidad: 2, precioUnitario: 1000, subtotal: 2000 }],
        descuento: { tipo: "ninguno", valor: 0 },
        pago: { metodo: "debito" },
        subtotal: 2000,
        total: 2000,
        caja: { cierreCajaId: "c1", estado: "abierta", fechaApertura: "2026-10-11T12:00:00.000Z" },
      });
      window.appApi = {
        invoke: async (channel, payload) => {
          window.calls.push({ channel, payload: payload ?? null });
          if (channel === "venta:verificar-caja") return { ok: true, data: { status: "sin_registro" } };
          if (channel === "venta:producto") return { ok: true, data: [product] };
          if (channel === "venta:validar-carrito") {
            return {
              ok: true,
              data: {
                lines: payload.items.map((item) => ({ ...product, ...item, precioUnitario: 1000, subtotal: item.cantidad * 1000 })),
                subtotal: payload.items.reduce((sum, item) => sum + item.cantidad * 1000, 0),
              },
            };
          }
          if (channel === "venta:registrar") {
            const subtotal = payload.items.reduce((sum, item) => sum + item.cantidad * 1000, 0);
            return {
              ok: true,
              data: {
                ventaId: vigenteId,
                fechaHora: "2026-10-11T16:00:00.000Z",
                responsable: { usuarioId: "12345678-9", nombre: "Ana Prueba", rol: "trabajador" },
                metodoPago: payload.metodoPago,
                subtotal,
                descuento: { tipo: "ninguno", valor: 0 },
                total: subtotal,
                detalle: payload.items.map((item) => ({ ...product, ...item, precioUnitario: 1000, subtotal: item.cantidad * 1000 })),
              },
            };
          }
          if (channel === "venta:buscar") {
            const ventas = [vigenteId, anuladaId].map((ventaId) => ({
              ventaId,
              fechaHora: "2026-10-11T16:00:00.000Z",
              responsable: { usuarioId: "12345678-9", nombre: "Ana Prueba", rol: "trabajador" },
              total: 2000,
              metodoPago: "debito",
              estado: ventaId === anuladaId ? "anulada" : "confirmada",
              puedeAnular: false,
            }));
            return { ok: true, data: { ventas, resumen: { ventasVigentes: 1, montoVigente: 2000, ventasAnuladas: 1 } } };
          }
          if (channel === "venta:detalle") return { ok: true, data: detail(payload.ventaId) };
          if (channel === "boleta:imprimir") {
            if (window.printMode === "fail") {
              return {
                ok: false,
                error: {
                  code: "TECHNICAL_ERROR",
                  message: "No fue posible imprimir la boleta. Revise que la impresora esté encendida, con papel y conectada. Destino: la impresora predeterminada del equipo.",
                },
              };
            }
            return { ok: true, data: { ventaId: payload.ventaId, copia: payload.copia, impresaEn: "2026-10-11T16:00:01.000Z" } };
          }
          throw new Error(`Canal inesperado: ${channel}`);
        },
      };
    },
    { vigenteId, anuladaId },
  );
  page.on("pageerror", (error) => page.evaluate((message) => window.pageErrors.push(message), error.message).catch(() => undefined));
  return page;
}
