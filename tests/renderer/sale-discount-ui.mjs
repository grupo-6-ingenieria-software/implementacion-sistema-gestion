import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

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
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript((sessionRole) => {
      window.saleRequests = [];
      window.saleMode = "error";
      const product = {
        productoId: 1,
        ean13: "7802920000015",
        nombre: "Leche",
        categoria: "Lácteos",
        precioVenta: 1000,
        stockDisponible: 6,
      };
      window.appApi = {
        invoke: async (channel, payload) => {
          if (channel === "venta:verificar-caja")
            return { ok: true, data: { status: "sin_registro" } };
          if (channel === "venta:producto")
            return { ok: true, data: [product] };
          if (channel === "venta:validar-carrito") {
            const data = {
              lines: payload.items.map((item) => ({
                ...product,
                ...item,
                precioUnitario: 1000,
                subtotal: item.cantidad * 1000,
              })),
              subtotal: payload.items.reduce(
                (sum, item) => sum + item.cantidad * 1000,
                0,
              ),
            };
            if (window.deferCart)
              return new Promise((resolve) => {
                window.resolveCart = () => resolve({ ok: true, data });
              });
            return { ok: true, data };
          }
          if (channel === "venta:registrar") {
            window.saleRequests.push(payload);
            if (window.saleMode === "throw")
              throw new Error("Fallo de transporte");
            if (window.saleMode === "error")
              return {
                ok: false,
                error: {
                  code: "TECHNICAL_ERROR",
                  message: "Error de guardado de prueba",
                },
              };
            const subtotal = payload.items.reduce(
              (sum, item) => sum + item.cantidad * 1000,
              0,
            );
            const discount = payload.descuento?.monto ?? 0;
            const response = {
              ok: true,
              data: {
                ventaId: "venta-cu37",
                fechaHora: "2026-09-11T16:00:00Z",
                responsable: {
                  usuarioId: "12345678-9",
                  nombre: "Ana Prueba",
                  rol: sessionRole,
                },
                metodoPago: payload.metodoPago,
                subtotal,
                descuento: {
                  tipo: discount ? "monto" : "ninguno",
                  valor: discount,
                  razon: payload.descuento?.razon,
                },
                total: subtotal - discount,
                montoRecibido: payload.montoRecibido,
                vuelto: (payload.montoRecibido ?? 0) - (subtotal - discount),
                detalle: payload.items.map((item) => ({
                  ...product,
                  ...item,
                  precioUnitario: 1000,
                  subtotal: item.cantidad * 1000,
                })),
              },
            };
            return new Promise((resolve) => {
              window.resolveSale = () => resolve(response);
            });
          }
          throw new Error(`Canal inesperado: ${channel}`);
        },
      };
    }, role);
    await page.goto(
      `${server.resolvedUrls.local[0]}tests/renderer/sale-discount-harness.html?rol=${role}`,
    );
    const open = page.getByRole("button", {
      name: "Aplicar descuento",
      exact: true,
    });
    const confirm = page.getByRole("button", { name: "Confirmar venta" });
    const total = page
      .getByText("Total", { exact: true })
      .first()
      .locator("..");
    const amount = page.getByLabel("Monto del descuento");
    const reason = page.getByLabel("Razón del descuento (obligatoria)");
    const apply = page.getByRole("button", { name: "Aplicar", exact: true });
    const dialog = page.getByRole("dialog");
    assert.equal(await open.isDisabled(), true);
    await page.getByRole("button", { name: "Sumar" }).click();
    const quantity = page
      .getByRole("heading", { name: "Carrito", exact: true })
      .locator("..")
      .locator("input");
    await quantity.fill("3");
    await quantity.blur();
    await page.waitForFunction(() =>
      document.body.textContent.includes("$3.000"),
    );
    await open.click();
    assert.equal(
      await amount.evaluate((element) => document.activeElement === element),
      true,
    );
    for (const value of [
      "",
      "-1",
      "1.5",
      "1,5",
      "15.00",
      "1e3",
      "abc",
      "9007199254740992",
      "3.001",
    ]) {
      await amount.fill(value);
      await apply.click();
      await dialog.getByRole("alert").first().waitFor();
      assert.equal(await amount.inputValue(), value);
      assert.match(await total.textContent(), /\$3\.000/);
    }
    await amount.fill("1.500");
    await apply.click();
    await dialog.getByRole("alert").filter({ hasText: "razón" }).waitFor();
    await reason.fill(" \t ");
    await apply.click();
    await dialog.getByRole("alert").filter({ hasText: "razón" }).waitFor();
    await reason.fill("  Promoción CU37  ");
    assert.equal(await page.evaluate(() => window.saleRequests.length), 0);
    // Native dialog keeps Tab navigation inside the modal.
    await apply.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
      true,
    );
    if (role === "dueno")
      await page.screenshot({ path: "out/cu37-modal.png", fullPage: true });
    await apply.click();
    await dialog.waitFor({ state: "detached" });
    assert.match(await total.textContent(), /\$1\.500/);
    const edit = page.getByRole("button", { name: "Editar descuento" });
    assert.equal(
      await edit.evaluate((element) => document.activeElement === element),
      true,
    );
    for (const closeMethod of ["Cancelar", "Escape", "Cerrar descuento"]) {
      await edit.click();
      await amount.fill("100");
      await reason.fill("Borrador");
      if (closeMethod === "Escape") await page.keyboard.press("Escape");
      else
        await dialog
          .getByRole("button", { name: closeMethod, exact: true })
          .click();
      await dialog.waitFor({ state: "detached" });
      assert.match(await total.textContent(), /\$1\.500/);
      assert.equal(
        await page.getByText("Razón del descuento: Promoción CU37").isVisible(),
        true,
      );
    }
    // Removing a product quantity invalidates, but does not cap, the applied discount.
    await page.evaluate(() => {
      window.deferCart = true;
    });
    await quantity.fill("1");
    await quantity.blur();
    assert.equal(await confirm.isDisabled(), true);
    await page.waitForFunction(() => Boolean(window.resolveCart));
    await page.evaluate(() => {
      window.resolveCart();
      window.deferCart = false;
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "mayor al subtotal" })
      .waitFor();
    assert.equal(await confirm.isDisabled(), true);
    assert.match(await total.textContent(), /Pendiente de corrección/);
    assert.equal(
      await page.getByText("Pendiente de corrección", { exact: true }).count(),
      2,
    );
    await edit.click();
    assert.equal(await amount.inputValue(), "1500");
    await amount.fill("0");
    await apply.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await page.getByText("Razón del descuento: Promoción CU37").count(),
      0,
    );
    assert.match(await total.textContent(), /\$1\.000/);
    await page.getByLabel("Monto recibido").fill("1000");
    await confirm.click();
    await page.getByText("Error de guardado de prueba").waitFor();
    assert.equal(
      await page.evaluate(() => window.saleRequests.at(-1).descuento),
      undefined,
    );
    await open.click();
    await amount.fill("500");
    await reason.fill("Quitar");
    await apply.click();
    await page.getByRole("button", { name: "Quitar descuento" }).click();
    assert.match(await total.textContent(), /\$1\.000/);
    await open.click();
    await amount.fill("1.000");
    await reason.fill("Cortesía CU37");
    await apply.click();
    assert.match(await total.textContent(), /\$0/);
    await page.getByLabel("Monto recibido").fill("0");
    await page.evaluate(() => {
      window.saleMode = "throw";
    });
    await confirm.click();
    await page
      .getByText("No fue posible completar la solicitud", { exact: false })
      .waitFor();
    assert.equal(await edit.isEnabled(), true);
    assert.equal(await quantity.inputValue(), "1");
    await page.evaluate(() => {
      window.saleMode = "defer";
    });
    await confirm.click();
    await page.getByRole("button", { name: "Registrando..." }).waitFor();
    assert.equal(await edit.isDisabled(), true);
    assert.equal(await quantity.isDisabled(), true);
    assert.equal(await page.getByLabel("Monto recibido").isDisabled(), true);
    await page.waitForFunction(() => Boolean(window.resolveSale));
    await page.evaluate(() => window.resolveSale());
    await page.getByRole("heading", { name: "Comprobante" }).waitFor();
    assert.equal(
      await page.getByText("Cortesía CU37", { exact: true }).isVisible(),
      true,
    );
    assert.equal(await open.isDisabled(), true);
    assert.equal(
      await page
        .getByText("Agregue productos para iniciar una venta.")
        .isVisible(),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => window.saleRequests.at(-1).descuento),
      { monto: 1000, razon: "Cortesía CU37" },
    );
    if (role === "dueno")
      await page.screenshot({
        path: "out/cu37-comprobante.png",
        fullPage: true,
      });
    assert.deepEqual(pageErrors, []);
    console.log(
      `PASS CU37 ${role}: modal, E1-E3, formato CLP, cancelación, foco, carrito, $0, errores y persistencia simulada`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
