import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { sql } from 'drizzle-orm';
import {
  createWorkerController,
  createWorkerWithExecutor,
  listWorkersWithExecutor,
} from '../../src/main/controllers/worker';
import { createShift, ShiftBusinessError, ShiftValidationError } from '../../src/main/controllers/shift';
import { normalizeShiftCreatePayload } from '../../src/shared/shifts';
import * as schema from '../../src/db/schema';
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
} from '../../src/main/controllers/auth-fixtures';

const fixture = await createAuthTestDatabase();
await seedUser(fixture.db, {
  usuarioId: '11111111-1',
  trabajadorId: 1,
  rut: '11111111-1',
  rolBd: 'dueno',
});

const controller = createWorkerController({
  authorize: async () => ({
    role: 'dueno', usuarioId: '11111111-1', usuarioRol: 'dueno', trabajadorNombre: 'Dueño',
  }),
  changeStatus: async () => { throw new Error('unexpected changeStatus'); },
  createWorker: (payload) => createWorkerWithExecutor(fixture.db, schema, payload),
  listWorkers: (filters) => listWorkersWithExecutor(fixture.db, schema, filters),
  listActiveWorkers: async () => [],
  updateWorker: async () => { throw new Error('unexpected updateWorker'); },
});

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'personal-ipc-bridge',
    configureServer(vite) {
      vite.middlewares.use('/__personal-ipc', (request, response) => {
        let body = '';
        request.on('data', (chunk) => { body += String(chunk); });
        request.on('end', () => {
          void (async () => {
            try {
              const message = JSON.parse(body) as { channel: string; payload: unknown };
              let result;
              if (message.channel === 'trabajador:listar-activos') {
                result = { ok: true, data: [{ trabajadorId: 1, rut: '11111111-1', nombreCompleto: 'Dueño' }] };
              } else if (message.channel === 'turno:crear') {
                try {
                  result = { ok: true, data: await createShift(
                    fixture.db as never,
                    normalizeShiftCreatePayload(message.payload),
                    { role: 'dueno', usuarioId: '11111111-1' },
                  ) };
                } catch (error) {
                  if (error instanceof ShiftValidationError) {
                    result = { ok: false, error: { code: 'VALIDATION_ERROR', message: error.message, fieldErrors: error.fieldErrors } };
                  } else if (error instanceof ShiftBusinessError) {
                    result = { ok: false, error: { code: 'BUSINESS_ERROR', message: error.message } };
                  } else {
                    throw error;
                  }
                }
              } else {
                result = await controller.handle(message.payload, { channel: message.channel });
              }
              response.setHeader('content-type', 'application/json');
              response.end(JSON.stringify(result));
            } catch (error) {
              response.statusCode = 500;
              response.end(String(error));
            }
          })();
        });
      });
    },
  }],
});

await server.listen();
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ?? (existsSync(systemChrome) ? systemChrome : undefined),
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const baseUrl = `${server.resolvedUrls!.local[0]}tests/renderer/personal-harness.html`;
  await page.goto(baseUrl);
  await page.getByLabel('RUT').fill('12.345.678-5');
  await page.getByLabel('Nombre completo').fill('Ana Soto');
  await page.getByLabel('Telefono').fill('123');
  await page.getByLabel('Correo opcional').fill('a@b.c');
  await page.getByRole('button', { name: 'Guardar trabajador' }).click();

  await page.getByText('El telefono debe tener 9 digitos numericos.').waitFor();
  await page.getByText('Ingrese un correo electronico valido.').waitFor();
  const calls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string; payload: Record<string, unknown> }> }).calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'trabajador:registrar');
  assert.equal(calls[0].payload.telefono, '123');
  assert.equal(calls[0].payload.correoElectronico, 'a@b.c');

  await page.reload();
  await page.getByRole('button', { name: 'Guardar trabajador' }).click();
  await page.getByText('Ingrese el RUT del trabajador.').waitFor();
  await page.getByText('Ingrese el nombre completo.').waitFor();
  await page.getByText('Ingrese el telefono de contacto.').waitFor();
  const emptyCalls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string }> }).calls);
  assert.equal(emptyCalls.length, 1);
  assert.equal(emptyCalls[0].channel, 'trabajador:registrar');

  const rows = await fixture.db.all<{ total: number }>(sql`SELECT COUNT(*) AS total FROM trabajador`);
  assert.equal(Number(rows[0]?.total), 1, 'el backend inválido no debe insertar trabajador');
  console.log('PASS RF21 E2/E3/E4 vista → IPC → controlador con fixture SQL real');

  await page.goto(`${baseUrl}?view=shift`);
  await page.getByLabel('Trabajador activo').selectOption('1');
  await page.getByLabel('Fecha (DD/MM/AAAA)').fill('15/06/2026');
  await page.getByLabel('Hora inicio (HH:MM)').fill('16:00');
  await page.getByLabel('Hora termino (HH:MM)').fill('08:00');
  await page.getByRole('button', { name: 'Guardar turno' }).click();
  await page.getByText('La hora de termino debe ser posterior a la hora de inicio.').waitFor();
  let shiftCalls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string }> }).calls);
  assert.equal(shiftCalls.filter((call) => call.channel === 'turno:crear').length, 1);

  await page.getByLabel('Fecha (DD/MM/AAAA)').fill('31/02/2026');
  await page.getByLabel('Hora inicio (HH:MM)').fill('08:00');
  await page.getByLabel('Hora termino (HH:MM)').fill('16:00');
  await page.getByRole('button', { name: 'Guardar turno' }).click();
  await page.getByText('Ingrese la fecha en formato DD/MM/AAAA.').waitFor();
  shiftCalls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string }> }).calls);
  assert.equal(shiftCalls.filter((call) => call.channel === 'turno:crear').length, 2);
  const shiftRows = await fixture.db.all<{ total: number }>(sql`SELECT COUNT(*) AS total FROM turno`);
  assert.equal(Number(shiftRows[0]?.total), 0);
  console.log('PASS RF25 E1/E3 vista → IPC → validación SQL real');

  await page.goto(`${baseUrl}?view=list`);
  await page.getByText('11111111-1').waitFor();
  await page.getByRole('button', { name: 'Registrar trabajador' }).waitFor();
  await page.getByRole('button', { name: 'Editar' }).waitFor();
  await page.getByRole('button', { name: 'Inactivar' }).waitFor();
  console.log('PASS CU24 dueno ve tabla y acciones administrativas');

  await page.goto(`${baseUrl}?view=list&role=trabajador`);
  await page.getByText('11111111-1').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Registrar trabajador' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Editar' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Inactivar' }).count(), 0);
  await page.getByRole('button', { name: 'Turnos' }).waitFor();
  const listarCalls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string; payload: Record<string, unknown> }> }).calls);
  assert.ok(listarCalls.some((call) => call.channel === 'trabajador:listar' && call.payload.usuarioId === '11111111-1'));
  console.log('PASS CU24 trabajador consulta sin acciones administrativas');

  await page.getByLabel('Buscar por nombre o RUT').fill('zzz');
  await page.getByText('No se encontraron trabajadores').waitFor();
  const filterCalls = await page.evaluate(() => (window as unknown as { calls: Array<{ channel: string; payload: Record<string, unknown> }> }).calls);
  const lastListar = [...filterCalls].reverse().find((call) => call.channel === 'trabajador:listar');
  assert.equal(lastListar?.payload.search, 'zzz');
  assert.equal(lastListar?.payload.rol, 'todos');
  assert.equal(lastListar?.payload.estado, 'todos');
  console.log('PASS CU24 filtro reinvoca trabajador:listar y muestra lista vacia');

} finally {
  await browser.close();
  await server.close();
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
}
