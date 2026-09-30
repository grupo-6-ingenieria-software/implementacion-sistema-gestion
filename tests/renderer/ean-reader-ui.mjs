import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false, root: process.cwd(), esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
let browser;
let passed = 0;
try {
  browser = await chromium.launch({
    headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? chromium.executablePath(),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.calls = [];
    window.submittedCodes = [];
    const product = {
      productoId: 1, ean13: '7802920000015', nombre: 'Leche', categoria: 'Bebidas', categoriaId: 1,
      precioVenta: 1000, stockDisponible: 20, stockActual: 20, stockMinimo: 1,
      estado: 'activo', fechaRegistro: '2026-06-01', exigeVencimiento: false,
    };
    window.appApi = {
      invoke: async (channel, payload) => {
        window.calls.push({ channel, payload });
        if (channel === 'ean:validar-captura') {
          if (window.deferCapture) return new Promise(resolve => { window.resolveCapture = resolve; });
          if (window.failCapture) return { ok: false, error: { code: 'DATABASE_ERROR', message: 'Consulta temporalmente no disponible' } };
          if (payload.mode === 'buscar-producto' && payload.value !== product.ean13) {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'Producto no encontrado' } };
          }
          return { ok: true, data: { ean13: payload.value, ...(payload.mode === 'buscar-producto' ? { producto: product } : {}) } };
        }
        if (channel === 'ean:registrar-fallo') {
          if (window.deferReport) return new Promise(resolve => { window.resolveReport = resolve; });
          if (window.rejectReport) throw new Error('IPC offline');
          if (window.failReport) return { ok: false, error: { code: 'DATABASE_ERROR', message: 'No fue posible registrar la auditoria.' } };
          return { ok: true, data: { registrado: true } };
        }
        if (channel === 'venta:verificar-caja') return { ok: true, data: { status: 'sin_registro' } };
        if (channel === 'venta:producto' || channel === 'producto:buscar-activo') return { ok: true, data: [product] };
        if (channel === 'venta:validar-carrito') {
          const lines = payload.items.map(item => ({ ...product, ...item, precioUnitario: 1000, subtotal: item.cantidad * 1000 }));
          return { ok: true, data: { lines, subtotal: lines.reduce((sum, item) => sum + item.subtotal, 0) } };
        }
        if (channel === 'producto:listar') return { ok: true, data: { products: [product], categories: [{ id: 1, nombre: 'Bebidas' }] } };
        if (channel === 'producto:buscar' || channel === 'producto:estado') return { ok: true, data: { product, categories: [{ id: 1, nombre: 'Bebidas' }] } };
        if (channel === 'producto:registrar') return { ok: true, data: { ean13: payload.ean13 } };
        if (channel === 'lote:proveedores') return { ok: true, data: [{ id: 1, nombre: 'Proveedor' }] };
        if (channel === 'merma:disponibilidad') return { ok: true, data: { ean13: product.ean13, stockDisponible: 20, criterioSalida: 'fifo' } };
        if (channel === 'ajuste:disponibilidad') return { ok: true, data: {
          ean13: product.ean13, productoNombre: product.nombre,
          lots: [{ loteId: 'lote-1', cantidadActual: 20, precioCosto: 600, fechaIngreso: '2026-06-01' }],
        } };
        if (channel === 'movimiento:historial') return { ok: true, data: {
          movements: window.paginatedHistory ? [{
            id: 'mov-1', fecha: '2026-06-01T12:00:00', tipo: 'ajuste', productoNombre: 'Leche',
            productoEan13: product.ean13, cantidad: 3, descripcion: 'Conteo', usuarioNombre: 'Ana',
          }] : [],
          total: window.paginatedHistory ? 101 : 0, page: payload.page, pageSize: 50,
        } };
        throw new Error(`Canal inesperado: ${channel}`);
      },
    };
  });
  const base = server.resolvedUrls.local[0];
  let navigation = 0;
  async function open(view = 'input', hash = '', extra = '') {
    pageErrors.length = 0;
    await page.goto(`${base}tests/renderer/ean-reader-harness.html?view=${view}&run=${++navigation}${extra}#${hash}`);
    await page.locator('input[placeholder="EAN-13"]').waitFor();
  }
  const ean = () => page.locator('input[placeholder="EAN-13"]');
  const report = () => page.getByRole('button', { name: 'Reportar lectura fallida', exact: true });
  async function count(channel) { return page.evaluate(channel => window.calls.filter(call => call.channel === channel).length, channel); }
  async function check(name, run) {
    await run();
    assert.deepEqual(pageErrors, [], `Errores de renderer en ${name}`);
    console.log(`PASS ${name}`);
    passed++;
  }

  await check('auto capture + immediate/late Enter submit only once and never submit the form', async () => {
    await open();
    await ean().pressSequentially('7802920000015');
    await page.keyboard.press('Enter');
    await page.getByTestId('captures').filter({ hasText: /^1$/ }).waitFor();
    await ean().press('Enter');
    await ean().press('Enter');
    assert.equal(await count('ean:validar-captura'), 1);
    assert.equal(await page.getByTestId('forms').textContent(), '0');
    assert.equal(await ean().evaluate(input => input === document.activeElement), true);
  });
  await check('Enter during delayed IPC does not duplicate the capture', async () => {
    await open();
    await page.evaluate(() => { window.deferCapture = true; });
    await ean().fill('7802920000015');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.resolveCapture));
    await page.evaluate(() => window.resolveCapture({ ok: true, data: { ean13: '7802920000015' } }));
    await page.getByTestId('captures').filter({ hasText: /^1$/ }).waitFor();
    assert.equal(await count('ean:validar-captura'), 1);
    assert.equal(await page.getByTestId('forms').textContent(), '0');
  });
  await check('a cleared field accepts the same EAN again without a suffix error', async () => {
    await open('input', '', '&clear=1');
    for (const expected of [1, 2]) {
      await ean().fill('7802920000015');
      await page.getByTestId('captures').filter({ hasText: new RegExp(`^${expected}$`) }).waitFor();
      await ean().press('Enter');
    }
    assert.equal(await count('ean:validar-captura'), 2);
    assert.equal(await page.getByRole('alert').count(), 0);
  });
  await check('prefilled/disabled fields do not trigger automatic captures', async () => {
    await open('input', '', '&prefill=7802920000015');
    assert.equal(await count('ean:validar-captura'), 0);
    await ean().press('Enter');
    await page.getByTestId('captures').filter({ hasText: /^1$/ }).waitFor();
    await open('input', '', '&disabled=1&prefill=7802920000015');
    assert.equal(await ean().isDisabled(), true);
    assert.equal(await count('ean:validar-captura'), 0);
    await report().click();
    await page.getByRole('status').waitFor();
    assert.equal(await ean().inputValue(), '7802920000015');
    assert.equal(await ean().isDisabled(), true);
  });
  await check('invalid checksum, manual correction and unknown product keep the input usable', async () => {
    await open();
    await ean().fill('7802920000017');
    await ean().press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Código inválido' }).waitFor();
    assert.equal(await count('ean:validar-captura'), 0);
    await ean().fill('4006381333931');
    await page.getByRole('alert').filter({ hasText: 'Producto no encontrado' }).waitFor();
    await ean().fill('7802920000015');
    await page.getByTestId('captures').filter({ hasText: /^1$/ }).waitFor();
  });
  await check('capture failure can be retried explicitly without another scan', async () => {
    await open();
    await page.evaluate(() => { window.failCapture = true; });
    await ean().fill('7802920000015');
    await page.getByRole('alert').filter({ hasText: 'Consulta temporalmente' }).waitFor();
    await page.evaluate(() => { window.failCapture = false; });
    await page.getByRole('button', { name: 'Reintentar lectura' }).click();
    await page.getByTestId('captures').filter({ hasText: /^1$/ }).waitFor();
    assert.equal(await ean().evaluate(input => input === document.activeElement), true);
    assert.equal(await count('ean:validar-captura'), 2);
  });
  await check('report sends only module, preserves input/form, handles audit and transport errors and retries', async () => {
    await open();
    await ean().fill('780');
    await page.evaluate(() => { window.failReport = true; });
    await report().click();
    await page.getByRole('alert').filter({ hasText: 'registrar la auditoria' }).waitFor();
    assert.equal(await ean().inputValue(), '780');
    assert.equal(await ean().evaluate(input => input === document.activeElement), true);
    await page.evaluate(() => { window.failReport = false; window.rejectReport = true; });
    await report().click();
    await page.getByRole('alert').filter({ hasText: 'registrar la lectura fallida' }).waitFor();
    await page.evaluate(() => { window.rejectReport = false; });
    await report().click();
    await page.getByRole('status').waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.channel === 'ean:registrar-fallo').map(call => call.payload)),
      [{ modulo: 'ventas' }, { modulo: 'ventas' }, { modulo: 'ventas' }]);
    assert.equal(await page.getByLabel('Otro campo').inputValue(), 'conservar');
    assert.equal(await page.getByTestId('forms').textContent(), '0');
  });
  await check('pending report keeps the input enabled and does not steal focus after completion', async () => {
    await open();
    await page.evaluate(() => { window.deferReport = true; });
    await report().click();
    await page.waitForFunction(() => Boolean(window.resolveReport));
    assert.equal(await ean().isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Reportando lectura fallida...' }).isDisabled(), true);
    assert.equal(await count('ean:registrar-fallo'), 1);
    await page.getByLabel('Otro campo').fill('editado');
    await page.evaluate(() => window.resolveReport({ ok: true, data: { registrado: true } }));
    await page.getByRole('status').waitFor();
    assert.equal(await page.getByLabel('Otro campo').evaluate(input => input === document.activeElement), true);
  });

  // Las vistas se verifican después de aprobar el bloque central.
  if (!process.argv.includes('--central')) {
    await check('sale scanning uses the existing cart once, report success/failure preserves payment and cart', async () => {
      await open('sale', '/app/ventas/registrar');
      await ean().fill('7802920000015');
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Carrito', exact: true }).locator('..').getByText('Leche', { exact: true }).waitFor();
      assert.equal(await count('venta:validar-carrito'), 1);
      assert.equal(await count('venta:registrar'), 0);
      const cart = page.getByRole('heading', { name: 'Carrito', exact: true }).locator('..');
      await page.getByLabel('Monto recibido').fill('5000');
      const previous = await cart.textContent();
      for (const fail of [true, false]) {
        await page.evaluate(fail => { window.failReport = fail; }, fail);
        await report().click();
        await page.getByText(fail ? 'No fue posible registrar la auditoria.' : 'Lectura fallida registrada. Puede reintentar o ingresar el código manualmente.', { exact: true }).waitFor();
        assert.equal(await cart.textContent(), previous);
        assert.equal(await page.getByLabel('Monto recibido').inputValue(), '5000');
        assert.equal(await count('venta:registrar'), 0);
      }
      await ean().fill('7802920000015');
      await page.waitForFunction(() => window.calls.filter(call => call.channel === 'venta:validar-carrito').length === 2);
    });
    await check('new product accepts an unknown valid EAN without lookup or automatic form submission', async () => {
      await open('create', '/app/inventario/productos/nuevo');
      await ean().fill('4006381333931');
      await page.waitForFunction(() => window.calls.some(call => call.channel === 'ean:validar-captura'));
      await ean().press('Enter');
      assert.deepEqual(await page.evaluate(() => window.calls.find(call => call.channel === 'ean:validar-captura').payload),
        { value: '4006381333931', mode: 'validar' });
      assert.equal(await count('producto:registrar'), 0);
      assert.equal(await page.getByText('Producto no encontrado', { exact: true }).count(), 0);
      await report().click();
      await page.getByRole('status').waitFor();
      assert.equal(await ean().inputValue(), '4006381333931');
      await page.getByLabel('Nombre', { exact: true }).fill('Producto nuevo');
      await page.getByLabel(/^Categoria/).selectOption('1');
      await page.getByLabel('Stock minimo', { exact: true }).fill('2');
      await page.getByLabel('Precio costo', { exact: true }).fill('600');
      await page.getByLabel('Precio venta', { exact: true }).fill('1000');
      await page.getByRole('button', { name: 'Guardar producto', exact: true }).click();
      await page.waitForFunction(() => window.calls.some(call => call.channel === 'producto:registrar'));
      assert.equal(await page.evaluate(() => window.calls.find(call => call.channel === 'producto:registrar').payload.ean13), '4006381333931');
    });
    for (const [view, path, channel] of [
      ['delete', '/app/inventario/productos/eliminar', 'producto:buscar'],
      ['lot', '/app/inventario/lotes/nuevo', 'producto:buscar-activo'],
      ['waste', '/app/inventario/mermas/nueva', 'producto:buscar-activo'],
      ['order', '/app/proveedores/pedidos/nuevo', 'producto:buscar-activo'],
    ]) {
      await check(`${view} integrates unchanged callback with one complete EAN and no form submission`, async () => {
        await open(view, path);
        await ean().fill('7802920000015');
        await page.waitForFunction(channel => window.calls.some(call => call.channel === channel), channel);
        const calls = await page.evaluate(channel => window.calls.filter(call => call.channel === channel), channel);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].payload.ean13 ?? calls[0].payload.query, '7802920000015');
        await report().click();
        await page.getByRole('status').waitFor();
        assert.equal(await count('lote:registrar'), 0);
        assert.equal(await count('merma:registrar'), 0);
        assert.equal(await count('pedido:registrar'), 0);
        assert.equal(await count('producto:eliminar'), 0);
      });
    }
    await check('product list applies only complete valid EAN and preserves other filters', async () => {
      await open('products', '/app/inventario/productos');
      await page.waitForFunction(() => window.calls.some(call => call.channel === 'producto:listar'));
      await page.getByLabel(/^Categoria/).selectOption('1');
      await page.getByLabel('Ordenar por').selectOption('stockActual');
      await page.getByLabel('Direccion').selectOption('desc');
      const before = await count('producto:listar');
      await ean().fill('780');
      await page.getByRole('button', { name: 'Reportar lectura fallida' }).waitFor();
      assert.equal(await count('producto:listar'), before);
      await ean().fill('7802920000015');
      await page.waitForFunction(() => window.calls.some(call => call.channel === 'producto:listar' && call.payload.search === '7802920000015'));
      await report().click();
      await page.getByRole('status').waitFor();
      assert.equal(await ean().inputValue(), '7802920000015');
      assert.equal(await page.getByLabel(/^Categoria/).inputValue(), '1');
      assert.equal(await page.getByLabel('Ordenar por').inputValue(), 'stockActual');
      assert.equal(await page.getByLabel('Direccion').inputValue(), 'desc');
    });
    await check('V21 reports without losing selected lot, quantity or justification', async () => {
      await open('adjustment', '/app/inventario/ajustes');
      await ean().fill('7802920000015');
      await page.getByRole('heading', { name: 'Ajuste de stock — Leche' }).waitFor();
      await page.getByRole('button').filter({ hasText: 'Cant: 20' }).click();
      await page.locator('input[type=number]').fill('3');
      await page.locator('textarea').fill('Conteo manual');
      for (const fail of [true, false]) {
        await page.evaluate(fail => { window.failReport = fail; }, fail);
        await report().click();
        await page.getByText(fail ? 'No fue posible registrar la auditoria.' : 'Lectura fallida registrada. Puede reintentar o ingresar el código manualmente.', { exact: true }).waitFor();
        assert.equal(await page.locator('input[type=number]').inputValue(), '3');
        assert.equal(await page.locator('textarea').inputValue(), 'Conteo manual');
        assert.equal(await page.getByRole('button', { name: 'Registrar ajuste', exact: true }).isEnabled(), true);
      }
      assert.equal(await count('ajuste:disponibilidad'), 1);
      assert.equal(await count('ajuste:registrar'), 0);
      await ean().fill('4006381333931');
      await page.getByRole('alert').filter({ hasText: 'Producto no encontrado' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Registrar ajuste', exact: true }).count(), 0);
    });
    await check('V21 keeps selection by name and its read-only EAN when reporting', async () => {
      await open('adjustment', '/app/inventario/ajustes');
      await page.getByPlaceholder('Nombre del producto').fill('Lech');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await page.getByRole('button', { name: /Leche.*7802920000015/ }).click();
      await page.getByRole('heading', { name: 'Ajuste de stock — Leche' }).waitFor();
      await page.getByRole('button').filter({ hasText: 'Cant: 20' }).click();
      await page.locator('input[type=number]').fill('4');
      await page.locator('textarea').fill('Seleccionado por nombre');
      await report().click();
      await page.getByRole('status').waitFor();
      assert.equal(await ean().isDisabled(), true);
      assert.equal(await ean().inputValue(), '7802920000015');
      assert.equal(await page.locator('input[type=number]').inputValue(), '4');
      assert.equal(await page.locator('textarea').inputValue(), 'Seleccionado por nombre');
      assert.equal(await page.getByRole('button', { name: 'Registrar ajuste', exact: true }).isEnabled(), true);
      assert.equal(await count('ajuste:disponibilidad'), 1);
      assert.equal(await count('ean:validar-captura'), 0);
    });
    await check('V22 preserves dates/type/page and applies EAN once after validation; clearing restores all-products filter', async () => {
      await open('movements', '/app/inventario/movimientos');
      await page.evaluate(() => { window.paginatedHistory = true; });
      await page.getByLabel('Desde').fill('2026-06-01');
      await page.getByLabel('Hasta').fill('2026-06-30');
      const select = page.getByLabel('Tipo de movimiento');
      const type = await select.locator('option').nth(1).getAttribute('value');
      await select.selectOption(type);
      const before = await count('movimiento:historial');
      await ean().fill('780');
      assert.equal(await count('movimiento:historial'), before);
      await ean().fill('7802920000015');
      await page.waitForFunction(() => window.calls.some(call => call.channel === 'movimiento:historial' && call.payload.ean13 === '7802920000015'));
      assert.equal(await count('movimiento:historial'), before + 1);
      await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await page.getByText('Pagina 2 de 3', { exact: true }).waitFor();
      const queries = await count('movimiento:historial');
      for (const fail of [true, false]) {
        await page.evaluate(fail => { window.failReport = fail; }, fail);
        await report().click();
        await page.getByText(fail ? 'No fue posible registrar la auditoria.' : 'Lectura fallida registrada. Puede reintentar o ingresar el código manualmente.', { exact: true }).waitFor();
        assert.equal(await page.getByText('Pagina 2 de 3', { exact: true }).count(), 1);
        assert.equal(await count('movimiento:historial'), queries);
      }
      assert.equal(await page.getByLabel('Desde').inputValue(), '2026-06-01');
      assert.equal(await page.getByLabel('Hasta').inputValue(), '2026-06-30');
      assert.equal(await select.inputValue(), type);
      assert.equal(await ean().inputValue(), '7802920000015');
      await ean().fill('');
      await page.waitForFunction(() => window.calls.filter(call => call.channel === 'movimiento:historial').at(-1).payload.ean13 === undefined);
    });
    await check('V22 keeps the contextual initial product filter without automatically recapturing it', async () => {
      await open('movements', '/app/inventario/movimientos', '&initialEan13=7802920000015');
      await page.waitForFunction(() => window.calls.some(call => call.channel === 'movimiento:historial' && call.payload.ean13 === '7802920000015'));
      assert.equal(await ean().inputValue(), '7802920000015');
      assert.equal(await count('ean:validar-captura'), 0);
      await report().click();
      await page.getByRole('status').waitFor();
      assert.equal(await count('movimiento:historial'), 1);
    });
  }
  console.log(`${passed} pruebas interactivas EAN aprobadas.`);
} finally {
  await browser?.close();
  await server.close();
}
