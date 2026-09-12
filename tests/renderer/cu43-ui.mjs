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
  const rootUrl = server.resolvedUrls?.local[0];
  assert.ok(rootUrl);

  const sameUserPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await installBridge(sameUserPage);
  await sameUserPage.goto(
    `${rootUrl}tests/renderer/cu43-harness.html#/login`,
  );
  await login(sameUserPage, "12345678-9");
  await openSale(sameUserPage);

  await sameUserPage.getByText("Ana Prueba", { exact: true }).last().waitFor();
  assert.equal(
    await sameUserPage.getByText("Dueño", { exact: true }).count(),
    1,
  );
  assert.equal(await sameUserPage.locator("select").count(), 0);
  assert.equal(
    await sameUserPage.locator('input[value="Ana Prueba"]').count(),
    0,
  );

  await sameUserPage.getByRole("button", { name: "Sumar" }).click();
  await sameUserPage.getByText("Leche").last().waitFor();
  const quantity = sameUserPage
    .getByRole("heading", { name: "Carrito", exact: true })
    .locator("..")
    .locator("input");
  await quantity.fill("2");
  await quantity.blur();
  await sameUserPage.waitForFunction(() =>
    document.body.textContent.includes("$2.000"),
  );
  await sameUserPage
    .getByRole("button", { name: "Aplicar descuento", exact: true })
    .click();
  await sameUserPage.getByLabel("Monto del descuento").fill("200");
  await sameUserPage
    .getByLabel("Razón del descuento (obligatoria)")
    .fill("Promoción CU43");
  await sameUserPage
    .getByRole("button", { name: "Aplicar", exact: true })
    .click();
  await sameUserPage.getByLabel("Monto recibido").fill("3000");
  await sameUserPage
    .getByRole("button", { name: "Confirmar venta" })
    .click();

  await sameUserPage
    .getByText("Sesión expirada durante la venta", { exact: true })
    .waitFor();
  assert.equal(new URL(sameUserPage.url()).hash, "#/login");
  assert.equal(
    await sameUserPage.evaluate(() =>
      sessionStorage.getItem("huascar:venta-retorno:cu43"),
    ),
    "12345678-9",
  );
  const firstRequest = await sameUserPage.evaluate(() => window.saleRequests[0]);
  assert.deepEqual(firstRequest, {
    items: [
      { productoId: 1, ean13: "7802920000015", cantidad: 2 },
    ],
    metodoPago: "efectivo",
    montoRecibido: 3000,
    descuento: { monto: 200, razon: "Promoción CU43" },
  });

  await sameUserPage.evaluate(() => {
    window.requirePasswordChange = true;
  });
  await login(sameUserPage, "12345678-9");
  await sameUserPage
    .getByRole("heading", { name: "Cambio obligatorio de contraseña" })
    .waitFor();
  assert.equal(
    await sameUserPage.evaluate(() =>
      sessionStorage.getItem("huascar:venta-retorno:cu43"),
    ),
    "12345678-9",
  );
  await sameUserPage.getByLabel("Nueva contraseña", { exact: true }).fill("ClaveNueva1");
  await sameUserPage
    .getByLabel("Confirmar nueva contraseña")
    .fill("ClaveNueva1");
  await sameUserPage
    .getByRole("button", { name: "Cambiar contraseña" })
    .click();

  await sameUserPage
    .getByRole("heading", { name: "Carrito", exact: true })
    .waitFor();
  const restoredConfirm = sameUserPage.getByRole("button", {
    name: "Confirmar venta",
  });
  assert.equal(await restoredConfirm.isDisabled(), true);
  assert.equal(await sameUserPage.getByLabel("Monto recibido").inputValue(), "3000");
  assert.equal(
    await sameUserPage.getByText("Razón del descuento: Promoción CU43").isVisible(),
    true,
  );
  await sameUserPage.waitForFunction(() => Boolean(window.resolveRestoreValidation));
  await sameUserPage.evaluate(() => window.resolveRestoreValidation());
  await sameUserPage.waitForFunction(() =>
    document.body.textContent.includes("$2.000"),
  );
  assert.equal(await restoredConfirm.isEnabled(), true);
  assert.equal(
    await sameUserPage.evaluate(() => window.validationRequests.length >= 3),
    true,
  );

  await restoredConfirm.click();
  await sameUserPage
    .getByRole("heading", { name: "Comprobante" })
    .waitFor();
  assert.equal(
    await sameUserPage.getByText("Dueño", { exact: true }).count(),
    2,
  );
  assert.equal(
    await sameUserPage.evaluate(
      () => sessionStorage.getItem("huascar:venta-borrador:cu43"),
    ),
    null,
  );
  assert.deepEqual(await sameUserPage.evaluate(() => window.pageErrors), []);
  await sameUserPage.close();

  const otherUserPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await installBridge(otherUserPage);
  await otherUserPage.goto(`${rootUrl}tests/renderer/cu43-harness.html#/login`);
  await login(otherUserPage, "12345678-9");
  await openSale(otherUserPage);
  await otherUserPage.getByRole("button", { name: "Sumar" }).click();
  await otherUserPage.getByRole("button", { name: "Débito" }).click();
  await otherUserPage
    .getByRole("button", { name: "Confirmar venta" })
    .click();
  await otherUserPage
    .getByText("Sesión expirada durante la venta", { exact: true })
    .waitFor();
  await login(otherUserPage, "87654321-0");
  await otherUserPage
    .getByRole("heading", { name: "Inicio", exact: true })
    .waitFor();
  assert.equal(new URL(otherUserPage.url()).hash, "#/app/inicio");
  assert.equal(
    await otherUserPage.evaluate(
      () => sessionStorage.getItem("huascar:venta-borrador:cu43"),
    ),
    null,
  );
  assert.deepEqual(await otherUserPage.evaluate(() => window.pageErrors), []);
  await otherUserPage.close();

  const staleDraftPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await installBridge(staleDraftPage, { staleDraft: true });
  await staleDraftPage.goto(`${rootUrl}tests/renderer/cu43-harness.html#/login`);
  await login(staleDraftPage, "12345678-9");
  await staleDraftPage
    .getByText("El producto guardado ya no tiene stock suficiente.")
    .waitFor();
  assert.equal(
    await staleDraftPage
      .getByRole("button", { name: "Confirmar venta" })
      .isDisabled(),
    true,
  );
  await staleDraftPage.getByText("Leche guardada", { exact: true }).waitFor();
  await staleDraftPage.getByRole("button", { name: "Quitar" }).click();
  await staleDraftPage
    .getByText("Agregue productos para iniciar una venta.")
    .waitFor();
  assert.equal(
    await staleDraftPage.evaluate(
      () => sessionStorage.getItem("huascar:venta-borrador:cu43"),
    ),
    null,
  );
  assert.deepEqual(await staleDraftPage.evaluate(() => window.pageErrors), []);
  await staleDraftPage.close();

  console.log(
    "PASS CU43: responsable de solo lectura, payload sin identidad, reautenticación, contraseña temporal, revalidación y descarte entre usuarios",
  );
} finally {
  await browser?.close();
  await server.close();
}

async function installBridge(page, options = {}) {
  await page.addInitScript(({ staleDraft }) => {
    window.pageErrors = [];
    window.saleRequests = [];
    window.validationRequests = [];
    window.tokens = [];
    window.saleAttempts = 0;
    window.loginCounts = {};
    window.requirePasswordChange = false;
    window.forceValidationFailure = staleDraft;
    window.resolveRestoreValidation = null;
    if (staleDraft) {
      sessionStorage.setItem("huascar:venta-retorno:cu43", "12345678-9");
      sessionStorage.setItem(
        "huascar:venta-borrador:cu43",
        JSON.stringify({
          version: 1,
          usuarioId: "12345678-9",
          cart: [
            {
              productoId: 1,
              ean13: "7802920000015",
              nombre: "Leche guardada",
              categoria: "Lácteos",
              precioVenta: 900,
              stockDisponible: 2,
              cantidad: 2,
            },
          ],
          metodoPago: "debito",
          montoRecibido: "",
          descuento: null,
        }),
      );
    }
    window.addEventListener("error", (event) =>
      window.pageErrors.push(event.error?.message ?? event.message),
    );

    const product = {
      productoId: 1,
      ean13: "7802920000015",
      nombre: "Leche",
      categoria: "Lácteos",
      precioVenta: 1000,
      stockDisponible: 6,
    };
    const validation = (payload, price = 1000) => ({
      ok: true,
      data: {
        lines: payload.items.map((item) => ({
          productoId: item.productoId,
          ean13: product.ean13,
          nombre: product.nombre,
          categoria: product.categoria,
          cantidad: item.cantidad,
          precioUnitario: price,
          stockDisponible: price === 1000 ? 6 : 4,
          subtotal: item.cantidad * price,
        })),
        subtotal: payload.items.reduce(
          (sum, item) => sum + item.cantidad * price,
          0,
        ),
      },
    });

    window.appApi = {
      debugMode: false,
      setSessionToken: (token) => window.tokens.push(token),
      onSessionExpired: () => () => undefined,
      onDashboardUpdated: () => () => undefined,
      invoke: async (channel, payload) => {
        if (channel === "auth:login") {
          const loginId = payload.usuario;
          window.loginCounts[loginId] = (window.loginCounts[loginId] ?? 0) + 1;
          const owner = loginId === "123456789";
          const id = owner ? "12345678-9" : "87654321-0";
          return {
            ok: true,
            data: {
              token: `token-${id}-${window.loginCounts[loginId]}`,
              role: owner ? "dueno" : "trabajador",
              usuarioId: id,
              trabajadorNombre: owner ? "Ana Prueba" : "Luis Otro",
              usuarioRol: owner ? "dueno" : "trabajador",
              passwordChangeRequired:
                owner &&
                window.loginCounts[loginId] > 1 &&
                window.requirePasswordChange,
            },
          };
        }
        if (
          channel === "access:validate" ||
          channel === "auditoria:registrar" ||
          channel === "auth:cambiar-password" ||
          channel === "auth:logout"
        ) {
          return { ok: true, data: {} };
        }
        if (channel === "dashboard:cargar") {
          return {
            ok: false,
            error: { code: "TECHNICAL_ERROR", message: "Dashboard simulado" },
          };
        }
        if (channel === "venta:verificar-caja") {
          return { ok: true, data: { status: "sin_registro" } };
        }
        if (channel === "venta:producto") {
          return { ok: true, data: [product] };
        }
        if (channel === "venta:validar-carrito") {
          window.validationRequests.push(payload);
          if (window.forceValidationFailure) {
            return {
              ok: false,
              error: {
                code: "BUSINESS_RULE",
                message: "El producto guardado ya no tiene stock suficiente.",
              },
            };
          }
          if (window.saleAttempts > 0 && window.resolveRestoreValidation === null) {
            return new Promise((resolve) => {
              window.resolveRestoreValidation = () => resolve(validation(payload, 1100));
            });
          }
          return validation(payload);
        }
        if (channel === "venta:registrar") {
          window.saleRequests.push(payload);
          window.saleAttempts += 1;
          if (window.saleAttempts === 1) {
            return {
              ok: false,
              error: {
                code: "FORBIDDEN",
                message: "Sesión expirada durante la venta",
              },
            };
          }
          const subtotal = payload.items.reduce(
            (sum, item) => sum + item.cantidad * 1100,
            0,
          );
          const discount = payload.descuento?.monto ?? 0;
          return {
            ok: true,
            data: {
              ventaId: "00000000-0000-4000-8000-000000000401",
              fechaHora: "2026-09-11T18:00:00.000Z",
              responsable: {
                usuarioId: "12345678-9",
                nombre: "Ana Prueba",
                rol: "dueno",
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
                precioUnitario: 1100,
                subtotal: item.cantidad * 1100,
                historialPrecioProductoId: "price-1",
                exigeVencimiento: true,
                lotesConsumidos: [],
              })),
            },
          };
        }
        throw new Error(`Canal inesperado: ${channel}`);
      },
    };
  }, { staleDraft: Boolean(options.staleDraft) });
}

async function login(page, userId) {
  await page.getByLabel("Usuario").fill(userId);
  await page.getByLabel("Contraseña").fill("Clave1234");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

async function openSale(page) {
  await page.getByRole("button", { name: "Registrar venta" }).click();
  await page.getByRole("heading", { name: "Productos activos" }).waitFor();
}
