import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { createAuthTestDatabase, removeAuthTempDir, seedUser } from '../../src/main/controllers/auth-fixtures';
import { createLotController, registerLotWithExecutor } from '../../src/main/controllers/lot';
import { createProductWithExecutor, createProductWriteController, normalizeCreatePayload } from '../../src/main/controllers/product-write';
import { createWasteController, registerWasteWithExecutor } from '../../src/main/controllers/waste';
import { controllers } from '../../src/shared/controllers';
import { it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

it('forwards invalid inventory forms through Chromium, IPC controllers and SQL', async () => {
const fixture = await createAuthTestDatabase();
await seedUser(fixture.db, { usuarioId: '12345678-9', trabajadorId: 1, rut: '12345678-9', rolBd: 'dueno' });
await seedInventory();

const productController = createProductWriteController({
  channel: 'producto:registrar', controllerId: 'product-create', metadata: controllers[9], normalize: normalizeCreatePayload,
  dependencies: { save: (payload) => fixture.db.transaction(async (tx) => {
    await createProductWithExecutor(tx, schema, payload); return { ean13: payload.ean13 };
  }) },
});
const lotController = createLotController({
  listProviders: async () => [{ id: 1, nombre: 'Proveedor' }],
  register: (payload) => fixture.db.transaction((tx) => registerLotWithExecutor(tx, schema, payload)),
});
const wasteController = createWasteController({
  availability: async () => ({ ean13: '7802920000015', stockDisponible: 5, criterioSalida: 'fefo' }),
  register: (payload) => fixture.db.transaction((tx) => registerWasteWithExecutor(tx, schema, payload)),
});

const server = await createServer({
  configFile: false, root: process.cwd(), esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'inventory-ipc-bridge', configureServer(vite) {
    vite.middlewares.use('/__inventory-ipc', (request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += String(chunk); });
      request.on('end', () => { void (async () => {
        try {
          const message = JSON.parse(body) as { channel: string; payload: unknown };
          const result = message.channel === 'producto:listar'
            ? { ok: true, data: { products: [], categories: [{ id: 1, nombre: 'Lacteos' }] } }
            : message.channel === 'lote:proveedores'
              ? await lotController.handle(message.payload, { channel: message.channel })
              : message.channel === 'producto:registrar'
                ? await productController.handle(message.payload, { channel: message.channel })
                : message.channel === 'lote:registrar'
                  ? await lotController.handle(message.payload, { channel: message.channel })
                  : await wasteController.handle(message.payload, { channel: message.channel });
          response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result));
        } catch (error) { response.statusCode = 500; response.end(String(error)); }
      })(); });
    });
  } }],
});

await server.listen();
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(systemChrome) ? systemChrome : undefined) });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(10_000);
  await page.goto(`${server.resolvedUrls!.local[0]}tests/renderer/inventory-harness.html`);

  const product = page.getByTestId('product');
  await product.getByLabel('EAN-13').fill('7802920000046');
  await product.getByLabel('Nombre').fill('Producto nuevo');
  await product.getByLabel('Categoria').selectOption('1');
  await product.getByLabel('Precio venta').fill('1200');
  await product.getByRole('button', { name: 'Guardar producto' }).click();
  await product.getByText('El precio costo debe ser un entero mayor o igual a 0.').waitFor();
  await product.getByText('El stock minimo debe ser un entero mayor o igual a 0.').waitFor();

  const lot = page.getByTestId('lot');
  await lot.getByLabel('Producto').fill('7802920000015');
  await lot.getByLabel('Proveedor').selectOption('1');
  await lot.getByRole('button', { name: 'Registrar lote' }).click();
  await lot.getByText('La cantidad debe ser un entero mayor que 0.').waitFor();
  await lot.getByText('El costo del lote debe ser un entero mayor que 0.').waitFor();

  const waste = page.getByTestId('waste');
  await waste.getByLabel('Producto').fill('7802920000015');
  await waste.getByLabel('Motivo').selectOption('dano');
  await waste.getByRole('button', { name: 'Registrar merma' }).click();
  await waste.getByText('La cantidad debe ser un entero mayor que 0.').waitFor();

  const calls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string; payload: Record<string, unknown> }> }).calls);
  for (const channel of ['producto:registrar', 'lote:registrar', 'merma:registrar']) assert.equal(calls.filter((call) => call.channel === channel).length, 1);
  const productPayload = calls.find((call) => call.channel === 'producto:registrar')!.payload;
  assert.equal(Number.isNaN(productPayload.precioCosto), true, 'la vista conserva el vacío como inválido; nunca lo vuelve 0');
  const counts = await fixture.db.all<{ products: number; lots: number; wastes: number }>(sql`SELECT
    (SELECT COUNT(*) FROM producto) AS products, (SELECT COUNT(*) FROM lote) AS lots,
    (SELECT COUNT(*) FROM merma) AS wastes`);
  assert.deepEqual(counts[0], { products: 1, lots: 1, wastes: 0 });
  console.log('PASS RF01/RF05/RF10 vistas Chromium → IPC → controlador → SQL real');
} finally {
  await browser.close(); await server.close(); fixture.client.close(); await removeAuthTempDir(fixture.dir);
}

async function seedInventory(): Promise<void> {
  await fixture.db.run(sql`INSERT INTO categoria (categoria_id, categoria_nombre, categoria_exige_vencimiento) VALUES (1, 'Lacteos', 1)`);
  await fixture.db.run(sql`INSERT INTO producto (producto_id, producto_ean_13, producto_nombre, producto_precio_venta, producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id)
    VALUES (1, '7802920000015', 'Leche', 1000, 1, 'activo', '2026-01-01', 1)`);
  await fixture.db.run(sql`INSERT INTO proveedor (proveedor_id, proveedor_rut, proveedor_nombre_razon_social, proveedor_nombre_contacto, proveedor_telefono, proveedor_correo_electronico)
    VALUES (1, '76543210-K', 'Proveedor', 'Juan', '912345678', 'p@example.com')`);
  await fixture.db.run(sql`INSERT INTO lote (lote_id, lote_cantidad_inicial, lote_cantidad_actual, lote_precio_costo, lote_fecha_hora_ingreso, es_lote_perecible, es_lote_no_perecible, producto_id, proveedor_id)
    VALUES ('00000000-0000-4000-8000-000000000101', 5, 5, 700, '2026-01-01', 1, 0, 1, 1)`);
  await fixture.db.run(sql`INSERT INTO lote_perecible (lote_id, lote_perecible_fecha_vencimiento) VALUES ('00000000-0000-4000-8000-000000000101', '2027-01-01')`);
}
}, 30_000);
