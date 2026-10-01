import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
let browser;
try {
  await server.listen();
  await mkdir("out/cu20-qa", { recursive: true });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      ].find(existsSync),
  });
  for (const role of ["dueno", "trabajador"]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((role) => {
      window.exports = [];
      window.mode = "cancelled";
      window.appApi = {
        invoke: async (channel, payload) => {
          if (channel === "producto:listar")
            return {
              ok: true,
              data: {
                products: payload.search
                  ? []
                  : [
                      {
                        ean13: "0000000000001",
                        nombre: "Leche",
                        categoria: "Lácteos",
                        categoriaId: 1,
                        stockActual: 7,
                        stockMinimo: 4,
                        precioVenta: 150,
                        ...(role === "dueno" ? { precioCosto: 80 } : {}),
                        estado: "activo",
                        fechaRegistro: "2026-09-12",
                      },
                    ],
                categories: [{ id: 1, nombre: "Lácteos" }],
              },
            };
          if (channel !== "inventario:exportar-productos")
            throw new Error(`Unexpected ${channel}`);
          window.exports.push(payload);
          if (window.mode === "transport") throw new Error("IPC failure");
          if (window.mode === "E1" || window.mode === "E2")
            return {
              ok: false,
              error: {
                code: "BUSINESS_RULE",
                message:
                  window.mode === "E1"
                    ? "No hay productos para exportar"
                    : "No fue posible generar el archivo",
              },
            };
          const result = {
            ok: true,
            data: {
              formato: payload.formato,
              estado: window.mode === "cancelled" ? "cancelled" : "saved",
              cantidadFilas: 2,
              fechaGeneracion: "2026-09-12T23:30:00Z",
              ruta: `C:/Documentos/inventario.${payload.formato}`,
              auditoria: window.mode === "warning" ? "fallida" : "registrada",
              advertencia:
                "El archivo se guardó, pero no se pudo registrar la auditoría.",
            },
          };
          if (window.mode === "pending")
            return new Promise((resolve) => {
              window.finishExport = () => resolve(result);
            });
          return result;
        },
      };
    }, role);
    await page.goto(
      `${server.resolvedUrls.local[0]}tests/renderer/inventory-export-harness.html?rol=${role}`,
    );
    await page.getByText("1 productos", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("columnheader", { name: "Precio costo" }).count(),
      role === "dueno" ? 1 : 0,
    );
    await page
      .getByRole("textbox", { name: "Buscar por nombre" })
      .fill("no existe");
    await page
      .getByText("No se encontraron productos", { exact: true })
      .waitFor();
    const open = page.getByRole("button", {
      name: "Exportar listado",
      exact: true,
    });
    await open.click();
    const selector = page.getByLabel("Formato de exportación", { exact: true });
    assert.equal(
      await selector.evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Confirmar exportación", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.evaluate(() => window.exports.length), 0);
    assert.equal(
      await open.evaluate((element) => element === document.activeElement),
      true,
    );

    for (const [mode, format, message] of [
      ["cancelled", "xlsx", "Exportación cancelada."],
      ["E1", "pdf", "No hay productos para exportar"],
      ["E2", "xlsx", "No fue posible generar el archivo"],
      ["transport", "pdf", "No fue posible generar el archivo"],
      [
        "warning",
        "xlsx",
        "El archivo se guardó, pero no se pudo registrar la auditoría.",
      ],
    ]) {
      if (!(await selector.count()))
        await page
          .getByRole("button", { name: "Exportar listado", exact: true })
          .click();
      await selector.selectOption(format);
      await page.evaluate((value) => {
        window.mode = value;
      }, mode);
      await page
        .getByRole("button", { name: "Confirmar exportación", exact: true })
        .click();
      await page.getByText(message, { exact: mode !== "warning" }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.exports.at(-1)), {
        formato: format,
      });
    }

    await page
      .getByRole("button", { name: "Exportar listado", exact: true })
      .click();
    await selector.selectOption("pdf");
    await page.evaluate(() => {
      window.mode = "pending";
    });
    const previousCount = await page.evaluate(() => window.exports.length);
    await page
      .getByRole("button", { name: "Confirmar exportación", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Exportando...", exact: true })
        .count(),
      2,
    );
    assert.equal(await selector.isDisabled(), true);
    await page.locator("form").evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    assert.equal(
      await page.evaluate(() => window.exports.length),
      previousCount + 1,
    );
    await page.screenshot({
      path: `out/cu20-qa/${role}-pending.png`,
      fullPage: true,
    });
    await page.evaluate(() => window.finishExport());
    await page
      .getByText("Archivo guardado en C:/Documentos/inventario.pdf.", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: `out/cu20-qa/${role}-saved.png`,
      fullPage: true,
    });
    assert.equal(
      await page
        .getByRole("textbox", { name: "Buscar por nombre" })
        .inputValue(),
      "no existe",
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS CU20 ${role}: formatos, filtros, E1/E2, cancelación, advertencia y bloqueo de peticiones duplicadas`,
    );
  }
} finally {
  await browser?.close();
  await server.close();
}
