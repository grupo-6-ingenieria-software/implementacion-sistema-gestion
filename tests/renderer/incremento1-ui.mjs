// Interacciones reales en Chromium; API simulada para aislar navegación y cancelación.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ configFile: false, root: process.cwd(), esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
let checks = 0;
const pass = name => { checks++; console.log('PASS', name); };
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript(() => {
    window.calls = [];
    const worker = { trabajadorId:1,rut:'12345678-9',nombreCompleto:'Ana Prueba',turnoInicio:'2026-09-08T12:00:00Z',turnoFin:'2026-09-08T20:00:00Z' };
    window.appApi = {
      invoke: async (channel, payload) => {
        window.calls.push({channel,payload});
        if (channel==='trabajador:listar-activos') return {ok:true,data:[worker]};
        if (channel==='caja:resumen-cierre') {
          const zero={currentAmount:0,currentTransactions:0,voidedAmount:0,voidedTransactions:0};
          return {ok:true,data:{...zero,status:'abierta',generatedAt:'2026-09-08T20:00:00Z',openedAt:'2026-09-08T12:00:00Z',payments:{efectivo:zero,debito:zero,credito:zero,transferencia:zero}}};
        }
        if (channel==='trabajador:listar') return {ok:true,data:{users:[]}};
        if (channel.startsWith('producto:')) return {ok:true,data:{product:{productoId:1,ean13:'7802920000015',nombre:'Leche',precioVenta:1000,stockMinimo:2,stockActual:0,estado:'activo',categoriaId:1},categories:[{categoriaId:1,nombre:'Lácteos'}]}};
        if (channel.startsWith('asistencia:')) return {ok:true,data:{status:payload.fase==='confirmar'?'registered':window.withoutShift?'requires_no_shift_confirmation':'ready_for_confirmation',message:'Confirmación requerida',asistenciaId:'asistencia',entradaAt:'2026-09-08T12:00:00Z',salidaAt:'2026-09-08T20:00:00Z',horasTrabajadas:'08:00',trabajador:worker}};
        throw Error('Canal inesperado: '+channel);
      },
    };
  });
  const open = async view => { await page.goto(`${server.resolvedUrls.local[0]}tests/renderer/incremento1-harness.html?view=${view}`); };
  page.on('response', r=>{if(r.status()>=400) console.error(r.status(),r.url());});
  const attendanceCalls = () => page.evaluate(() => window.calls.filter(c=>c.channel.startsWith('asistencia:')));
  await open('AttendanceView');
  await page.getByRole('button',{name:'Registrar entrada',exact:true}).click();
  await page.getByText('Inicio del turno',{exact:true}).waitFor();
  assert.equal((await attendanceCalls())[0].payload.fase,'prevalidar');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal((await attendanceCalls()).length,1); pass('CU29 prevalidación y cancelación sin escritura');
  await page.getByRole('button',{name:'Registrar entrada',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar entrada',exact:true}).click();
  assert.deepEqual((await attendanceCalls()).map(c=>c.payload.fase),['prevalidar','prevalidar','confirmar']); pass('CU29 confirmación explícita');
  await open('AttendanceView');
  await page.getByRole('button',{name:/^Salida/}).click();
  await page.getByRole('button',{name:'Registrar salida',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal((await attendanceCalls()).length,1); pass('CU30 prevalidación y cancelación sin escritura');
  await page.getByRole('button',{name:'Registrar salida',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar salida',exact:true}).click();
  assert.equal((await attendanceCalls()).at(-1).payload.fase,'confirmar'); pass('CU30 confirmación explícita');
  await open('AttendanceView');
  await page.evaluate(()=>{window.withoutShift=true;});
  await page.getByRole('button',{name:'Registrar entrada',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal((await attendanceCalls()).length,1); pass('CU29b cancelación de advertencia');
  for (const view of ['ProductDeleteView','ProductStatusView']) {
    await open(view);
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.lastNavigation),'/app/inventario/productos');
    assert.equal(await page.evaluate(()=>window.calls.some(c=>['producto:eliminar','producto:cambiar-estado'].includes(c.channel))),false); pass('cancelación de producto sin escritura');
  }
  await open('WorkerListView');
  await page.getByRole('button',{name:'Turnos',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.lastNavigation),'/app/personal/turnos'); pass('CU25 navegación desde trabajadores a turnos');
  await page.getByRole('button',{name:'Registrar trabajador',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.lastNavigation),'/app/personal/trabajadores/nuevo'); pass('CU21 navegación al formulario');
  await open('CashClosingView');
  await page.getByRole('button',{name:'Cerrar caja',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.calls.some(c=>c.channel==='caja:cerrar')),false);
  pass('CU42 cancelación de cierre sin escritura');
  assert.deepEqual(errors,[]);
  console.log(`${checks} comprobaciones de interfaz pasaron en Chromium.`);
} finally { await browser.close(); await server.close(); }
