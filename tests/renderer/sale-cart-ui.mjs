import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.cartRequests = [];
    window.saleRequests = [];
    const product = {
      productoId: 1,
      ean13: '7802920000015',
      nombre: 'Leche',
      categoria: 'Lácteos',
      precioVenta: 1000,
      stockDisponible: 6,
    };
    window.appApi = {
      invoke: async (channel, payload) => {
        if (channel === 'venta:verificar-caja') return { ok: true, data: { status: 'sin_registro' } };
        if (channel === 'venta:producto') return { ok: true, data: [product] };
        if (channel === 'venta:validar-carrito') {
          return new Promise((resolve) => window.cartRequests.push({ payload, resolve }));
        }
        if (channel === 'venta:registrar') {
          window.saleRequests.push(payload);
          return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Regla SQL rechazada' } };
        }
        throw new Error(`Canal inesperado: ${channel}`);
      },
    };
  });
  const url = server.resolvedUrls?.local[0];
  assert.ok(url);
  await page.goto(`${url}tests/renderer/sale-cart-harness.html`);
  await page.getByRole('button', { name: 'Sumar' }).click();
  await page.waitForFunction(() => window.cartRequests.length === 1);
  assert.equal(await page.getByText('Agregue productos para iniciar una venta.').isVisible(), true);
  assert.match(await page.getByText('Total', { exact: true }).locator('..').textContent(), /\$0/);

  await page.evaluate(() => {
    const request = window.cartRequests[0];
    request.resolve({
      ok: true,
      data: { lines: [{ productoId: 1, ean13: '7802920000015', nombre: 'Leche', categoria: 'Lácteos', cantidad: 1, precioUnitario: 1000, stockDisponible: 6, subtotal: 1000 }], subtotal: 1000 },
    });
  });
  await page.getByText('Leche').last().waitFor();
  assert.match(await page.getByText('Total', { exact: true }).locator('..').textContent(), /\$1\.000/);

  const quantity = page.getByRole('heading', { name: 'Carrito', exact: true })
    .locator('..')
    .locator('input');
  await quantity.fill('2');
  await quantity.blur();
  await quantity.fill('3');
  await quantity.blur();
  await page.waitForFunction(() => window.cartRequests.length === 3);
  await page.evaluate(() => {
    const resolveAt = (index, cantidad) => window.cartRequests[index].resolve({
      ok: true,
      data: { lines: [{ productoId: 1, ean13: '7802920000015', nombre: 'Leche', categoria: 'Lácteos', cantidad, precioUnitario: 1000, stockDisponible: 6, subtotal: cantidad * 1000 }], subtotal: cantidad * 1000 },
    });
    resolveAt(2, 3);
    resolveAt(1, 2);
  });
  await page.waitForFunction(() => document.body.textContent.includes('$3.000'));
  assert.match(await page.getByText('Total', { exact: true }).locator('..').textContent(), /\$3\.000/);
  assert.equal(await page.getByRole('button', { name: 'Confirmar venta' }).isEnabled(), true);

  for (const [offset, invalid] of ['0', '-1', '1.5'].entries()) {
    await quantity.fill(invalid);
    await quantity.blur();
    const requestIndex = 3 + offset;
    await page.waitForFunction((length) => window.cartRequests.length === length, requestIndex + 1);
    assert.equal(
      await page.evaluate((index) => window.cartRequests[index].payload.items[0].cantidad, requestIndex),
      Number(invalid),
    );
    await page.evaluate((index) => window.cartRequests[index].resolve({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'La cantidad debe ser un entero mayor a cero.' },
    }), requestIndex);
    await page.getByText('La cantidad debe ser un entero mayor a cero.').waitFor();
    assert.equal(await quantity.inputValue(), '3');
    assert.match(await page.getByText('Total', { exact: true }).locator('..').textContent(), /\$3\.000/);
  }

  await page.getByRole('button', { name: 'Confirmar venta' }).click();
  await page.waitForFunction(() => window.saleRequests.length === 1);
  assert.equal(await page.evaluate(() => window.saleRequests[0].montoRecibido), null);
  await page.getByRole('button', { name: 'Aplicar descuento', exact: true }).click();
  await page.getByLabel('Monto del descuento').fill('100');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'razón del descuento' }).waitFor();
  assert.equal(await page.evaluate(() => window.saleRequests.length), 1);
  await page.getByLabel('Razón del descuento (obligatoria)').fill('Promoción');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar venta' }).click();
  await page.waitForFunction(() => window.saleRequests.length === 2);
  assert.deepEqual(
    await page.evaluate(() => window.saleRequests[1].descuento),
    { monto: 100, razon: 'Promoción' },
  );
  console.log('PASS carrito se publica tras validación vigente y descarta respuestas antiguas');
} finally {
  await browser.close();
  await server.close();
}
