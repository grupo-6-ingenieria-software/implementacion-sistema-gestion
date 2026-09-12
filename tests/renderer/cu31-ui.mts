import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "vite";

// Run with Node's native TypeScript support: node tests/renderer/cu31-ui.mts
// Avoid tsx's injected __name helper in functions serialized to the browser.
// UI simulation only; attendance-service.test.ts verifies real persistence and access.
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);
let browser;
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    const workers = [
      { trabajadorId: 1, rut: "12345678-9", nombreCompleto: "Ana Prueba",
        turnoInicio: "2026-09-08T12:00:00Z", turnoFin: "2026-09-08T20:00:00Z" },
      { trabajadorId: 2, rut: "23456789-0", nombreCompleto: "Luis Prueba" },
    ];
    const state = (window as any).cu31 = {
      calls: [] as { channel: string; payload: any }[],
      writes: [] as { channel: string; rut: string }[],
      records: {} as Record<string, { entradaAt: string; salidaAt?: string }>,
      withoutShift: false, failConfirm: false, hours: "08:00", hold: false,
      pending: [] as (() => void)[],
    };
    (window as any).appApi = {
      invoke: async (channel: string, payload: any) => {
        state.calls.push({ channel, payload });
        if (channel === "trabajador:listar-activos") {
          const owner = new URL(location.href).searchParams.get("role") === "dueno";
          return { ok: true, data: owner ? workers : [workers[0]] };
        }
        if (!["asistencia:entrada", "asistencia:entrada-sin-turno", "asistencia:salida"].includes(channel)) {
          throw Error(`Unexpected channel: ${channel}`);
        }
        const trabajador = workers.find(w => w.rut === payload.trabajadorRut);
        if (!trabajador) throw Error("Unexpected worker");
        const record = state.records[trabajador.rut];
        const exit = channel === "asistencia:salida";
        const fail = (message: string) => ({ ok: false, error: { code: "BUSINESS_RULE", message } });
        let response;
        if (state.failConfirm && payload.fase === "confirmar") {
          response = fail("Error de confirmación de prueba");
        } else if (exit && (!record || record.salidaAt)) {
          response = fail("No existe entrada abierta");
        } else if (!exit && record) {
          response = fail("Entrada duplicada");
        } else if (payload.fase === "prevalidar") {
          response = { ok: true, data: {
            status: !exit && state.withoutShift ? "requires_no_shift_confirmation" : "ready_for_confirmation",
            message: "Trabajador sin turno asignado", trabajador,
            ...(exit ? { asistenciaId: "asistencia", entradaAt: record.entradaAt } : {}),
          } };
        } else {
          const entradaAt = record?.entradaAt ?? "2026-09-08T12:00:00Z";
          const salidaAt = "2026-09-08T20:00:00Z";
          state.records[trabajador.rut] = { entradaAt, ...(exit ? { salidaAt } : {}) };
          state.writes.push({ channel, rut: trabajador.rut });
          response = { ok: true, data: {
            status: "registered", asistenciaId: "asistencia", trabajador, entradaAt,
            ...(exit ? { salidaAt, horasTrabajadas: state.hours } : {}),
          } };
        }
        return state.hold
          ? new Promise(resolve => state.pending.push(() => resolve(response)))
          : response;
      },
    };
  });

  const url = `${server.resolvedUrls!.local[0]}tests/renderer/incremento1-harness.html?view=AttendanceView`;
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const hours = page.locator("aside dl").filter({ has: page.locator("dt", { hasText: "Horas trabajadas" }) }).locator("dd");
  const expectHours = async (value: string) => {
    await hours.filter({ hasText: new RegExp(`^${value}$`) }).waitFor();
    assert.equal(await hours.textContent(), value);
  };
  const open = async (owner = false) => {
    await page.goto(url + (owner ? "&role=dueno" : ""));
    await page.getByRole("heading", { name: "Registro de asistencia", exact: true }).waitFor();
    await expectHours("Sin información");
  };
  const select = async (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  const writes = () => page.evaluate(() => (window as any).cu31.writes);
  const mutations = () => page.evaluate(() => (window as any).cu31.calls.filter((c: any) => c.payload.fase === "confirmar"));
  const enter = async () => {
    await button("Registrar entrada").click();
    await button("Confirmar entrada").click();
    await expectHours("Pendiente");
  };
  const exitMode = async () => page.getByRole("button", { name: /^Salida/ }).click();
  const previewExit = async () => {
    await exitMode();
    await button("Registrar salida").click();
    await button("Confirmar salida").waitFor();
  };
  const release = async () => {
    await page.evaluate(() => {
      const s = (window as any).cu31;
      s.hold = false;
      s.pending.splice(0).forEach((resolve: () => void) => resolve());
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };

  await open();
  await button("Registrar entrada").click();
  await button("Confirmar entrada").waitFor();
  await expectHours("Sin información");
  assert.equal((await writes()).length, 0);
  await button("Cancelar").click();
  assert.equal((await mutations()).length, 0);
  await expectHours("Sin información");
  await enter();
  assert.deepEqual(await writes(), [{ channel: "asistencia:entrada", rut: "12345678-9" }]);
  assert.equal(await page.evaluate(() => (window as any).cu31.records["12345678-9"].salidaAt), undefined);
  await button("Limpiar").click();
  await expectHours("Pendiente");
  pass("CU29: entrada confirmada, prevalidación/cancelación sin escritura y Limpiar propio");

  await previewExit();
  await expectHours("Pendiente");
  const beforeCancel = (await mutations()).length;
  await button("Cancelar").click();
  assert.equal((await mutations()).length, beforeCancel);
  assert.equal((await writes()).length, 1);
  await expectHours("Pendiente");
  await previewExit();
  await page.evaluate(() => { (window as any).cu31.failConfirm = true; });
  await button("Confirmar salida").click();
  await page.getByText("Error de confirmación de prueba", { exact: true }).waitFor();
  await expectHours("Pendiente");
  assert.equal((await writes()).length, 1);
  await page.evaluate(() => { (window as any).cu31.failConfirm = false; });
  await previewExit();
  await page.evaluate(() => { (window as any).cu31.hold = true; });
  await button("Confirmar salida").click();
  await page.waitForFunction(() => (window as any).cu31.pending.length === 1);
  await expectHours("Pendiente");
  await release();
  await expectHours("08:00");
  assert.equal((await writes()).length, 2);
  await page.getByRole("button", { name: /^Entrada/ }).click();
  await expectHours("08:00");
  assert.equal(await page.getByLabel("RUT del trabajador", { exact: true }).count(), 0);
  assert.ok((await mutations()).every((c: any) => c.payload.trabajadorRut === "12345678-9"));
  pass("CU30/CU31: cancelar/error conserva Pendiente, respuesta confirmada actualiza 08:00 y trabajador opera sobre sí mismo");

  await open();
  await page.evaluate(() => { (window as any).cu31.withoutShift = true; });
  await button("Registrar entrada").click();
  await button("Confirmar entrada").waitFor();
  await expectHours("Sin información");
  await button("Cancelar").click();
  assert.equal((await mutations()).length, 0);
  await expectHours("Sin información");
  await enter();
  assert.deepEqual(await writes(), [{ channel: "asistencia:entrada-sin-turno", rut: "12345678-9" }]);
  pass("CU29 sin turno: advertencia/cancelación no actualiza; confirmación registra y muestra Pendiente");

  await open();
  await enter();
  await page.evaluate(() => { (window as any).cu31.hours = "07:43"; });
  await previewExit();
  await button("Confirmar salida").click();
  await expectHours("07:43");
  pass("CU31 muestra literalmente el HH:MM de Main, sin derivarlo de los timestamps del mock");

  await open(true);
  await select("Ana Prueba");
  await enter();
  await select("Luis Prueba");
  await expectHours("Sin información");
  await select("Ana Prueba");
  await expectHours("Sin información");
  // A recorded exit can update the field even if this selection did not observe entry.
  await previewExit();
  await button("Confirmar salida").click();
  await expectHours("08:00");
  await page.getByLabel("RUT del trabajador", { exact: true }).fill("12.345.678-9");
  await expectHours("08:00");
  await page.getByLabel("RUT del trabajador", { exact: true }).fill("23456789-0");
  await expectHours("Sin información");
  await page.getByRole("button", { name: /^Entrada/ }).click();
  await enter();
  await button("Limpiar").click();
  await expectHours("Sin información");
  assert.equal(await page.getByLabel("RUT del trabajador", { exact: true }).inputValue(), "");
  await select("Luis Prueba");
  await expectHours("Sin información");
  pass("Dueño: cambio de selección/RUT y limpieza invalidan horas; formato equivalente del RUT las conserva");

  for (const kind of ["entrada", "entrada-sin-turno", "salida", "prevalidar"] as const) {
    await open(true);
    await select("Ana Prueba");
    if (kind === "salida") { await enter(); await previewExit(); }
    else if (kind !== "prevalidar") {
      await page.evaluate(withoutShift => { (window as any).cu31.withoutShift = withoutShift; }, kind === "entrada-sin-turno");
      await button("Registrar entrada").click();
      await button("Confirmar entrada").waitFor();
    }
    await page.evaluate(() => { (window as any).cu31.hold = true; });
    await button(kind === "prevalidar" ? "Registrar entrada" : kind === "salida" ? "Confirmar salida" : "Confirmar entrada").click();
    await page.waitForFunction(() => (window as any).cu31.pending.length === 1);
    await select("Luis Prueba");
    await expectHours("Sin información");
    // Even returning to A must not revive a response from its previous selection.
    await select("Ana Prueba");
    await release();
    await expectHours("Sin información");
    assert.equal(await button("Confirmar entrada").count(), 0);
    assert.equal(await button("Confirmar salida").count(), 0);
    assert.equal(await page.getByText(/Registro completado/).count(), 0);
    pass(`Respuesta tardía de ${kind} descartada tras A → B → A`);
  }

  await open(true);
  await select("Ana Prueba");
  await enter();
  await previewExit();
  await page.evaluate(() => { (window as any).cu31.hold = true; });
  await button("Confirmar salida").click();
  await page.waitForFunction(() => (window as any).cu31.pending.length === 1);
  await select("Luis Prueba");
  await page.evaluate(() => { (window as any).cu31.hold = false; });
  await page.getByRole("button", { name: /^Entrada/ }).click();
  await enter();
  await release();
  await expectHours("Pendiente");
  assert.ok((await page.locator("aside").textContent())?.includes("Luis Prueba"));
  assert.equal(await page.getByText(/Salida registrada a las/).count(), 0);
  pass("Respuesta tardía de A no sobrescribe el estado confirmado de B");

  assert.deepEqual(errors, []);
  console.log(`CU31 UI: ${checks} grupos de comprobaciones correctos.`);
} finally {
  await browser?.close();
  await server.close();
}
