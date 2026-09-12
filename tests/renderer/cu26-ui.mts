import assert from "node:assert/strict";
import { join } from "node:path";
import { withShiftUi, settle } from "./shift-ui-fixture.mjs";
import { addDaysToDateKey, getWeekStartDateKey, isoDateToDisplay } from "../../src/shared/shifts";

await withShiftUi("cu26", async (page, url, output) => {
  const week = getWeekStartDateKey();
  const nextWeek = addDaysToDateKey(week, 7);
  const editPath = "/app/personal/turnos/turno-1/editar";
  const ready = () => page.getByRole("heading", { name: "Calendario semanal de turnos" }).waitFor();
  const save = () => page.getByRole("button", { name: "Guardar cambios", exact: true });
  const openOwner = async () => { await page.goto(`${url}?role=dueno`); await ready(); };
  const navigate = (path: string) => page.evaluate((value) => (window as any).cu28.navigate(value), path);
  const enter = async (path = editPath) => { await navigate(path); await save().waitFor(); };
  const editCount = () => page.evaluate(() => (window as any).cu28.calls.filter((c: any) => c.channel === "turno:editar").length);

  // Direct route needs no week or stale calendar object.
  await page.goto(`${url}?role=dueno&path=${encodeURIComponent(editPath)}`);
  await save().waitFor();
  assert.equal(await page.getByLabel("Fecha (DD/MM/AAAA)").inputValue(), isoDateToDisplay(week));
  assert.equal(await page.getByLabel("Hora inicio (HH:MM)").inputValue(), "08:00");
  assert.equal(await page.getByRole("combobox").count(), 0);
  assert.ok(await page.getByText("Trabajador: Ana Soto", { exact: true }).isVisible());
  assert.equal(await page.getByRole("button", { name: "Eliminar turno", exact: true }).count(), 0);
  await page.screenshot({ path: join(output, "v18-edicion.png"), fullPage: true });
  await page.getByRole("button", { name: "Volver a turnos" }).click();
  await ready();
  assert.equal(await editCount(), 0);

  await page.goto(`${url}?role=trabajador&path=${encodeURIComponent(editPath)}`);
  await page.getByRole("alert").waitFor();
  assert.equal(await save().count(), 0);
  assert.equal(await page.evaluate(() => (window as any).cu28.navigated), "/app/inicio");

  // Cancel restores origin context even when it differs from the shift's week.
  await openOwner();
  await enter(`${editPath}?inicioSemana=${nextWeek}&trabajadorId=2`);
  await page.getByLabel("Hora inicio (HH:MM)").fill("09:00");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await ready();
  assert.ok(await page.getByText(`Semana del ${isoDateToDisplay(nextWeek)}`, { exact: false }).isVisible());
  assert.equal(await page.getByRole("combobox").inputValue(), "2");
  assert.equal(await editCount(), 0);

  // A successful cross-week edit preserves the filter and returns current data.
  await openOwner();
  await page.getByRole("combobox").selectOption("2");
  await page.getByRole("button", { name: "Luis Rojas 08:00 - 16:00" }).click();
  await page.getByRole("button", { name: "Editar turno", exact: true }).click();
  await save().waitFor();
  await page.getByLabel("Fecha (DD/MM/AAAA)").fill(isoDateToDisplay(nextWeek));
  await page.getByLabel("Hora inicio (HH:MM)").fill("09:00");
  await page.getByLabel("Hora termino (HH:MM)").fill("17:00");
  await save().click();
  await ready();
  await page.getByText("Turno actualizado correctamente.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox").inputValue(), "2");
  assert.ok(await page.getByText(`Semana del ${isoDateToDisplay(nextWeek)}`, { exact: false }).isVisible());
  await page.getByRole("button", { name: "Luis Rojas 09:00 - 17:00" }).waitFor();
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.waitForFunction(() => !document.body.textContent?.includes("Actualizando calendario..."));
  assert.equal(await editCount(), 1);
  await page.screenshot({ path: join(output, "retorno-semana-editada.png"), fullPage: true });

  // Equal/earlier end times never invoke Main; Main business failures preserve input.
  await openOwner();
  await enter();
  for (const end of ["07:00", "08:00"]) {
    await page.getByLabel("Hora termino (HH:MM)").fill(end);
    await save().click();
    await page.getByText("La hora de termino debe ser posterior", { exact: false }).waitFor();
    assert.equal(await editCount(), 0);
  }
  await page.getByLabel("Hora termino (HH:MM)").fill("17:00");
  for (const message of ["Conflicto de horario", "El turno ya inicio", "Asistencia registrada"]) {
    await page.evaluate((value) => { (window as any).cu28.mutationError = value; }, message);
    await save().click();
    await page.getByText(message, { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Hora termino (HH:MM)").inputValue(), "17:00");
  }

  // Load failure is retryable; attendance and missing shifts block the form.
  await openOwner();
  await page.evaluate(() => { (window as any).cu28.fail = true; });
  await navigate(editPath);
  await page.getByRole("alert").filter({ hasText: "Error de prueba CU28" }).waitFor();
  await page.evaluate(() => { (window as any).cu28.fail = false; });
  await page.getByRole("button", { name: "Reintentar" }).click();
  await save().waitFor();
  await openOwner();
  await page.evaluate(() => { (window as any).cu28.shiftOverrides["turno-1"] = { puedeModificar: false }; });
  await enter();
  assert.ok(await save().isDisabled());
  assert.ok(await page.getByLabel("Hora inicio (HH:MM)").isDisabled());
  await page.getByRole("alert").filter({ hasText: "Este turno ya inicio" }).waitFor();
  await openOwner();
  await page.evaluate(() => { (window as any).cu28.missingShiftIds = ["turno-1"]; });
  await navigate(editPath);
  await page.getByRole("alert").filter({ hasText: "no esta disponible" }).waitFor();
  assert.equal(await save().count(), 0);

  // A late response cannot reopen an abandoned form or overwrite another ID.
  await openOwner();
  await page.evaluate(() => { (window as any).cu28.hold = true; });
  await navigate(editPath);
  await page.getByText("Cargando turno...", { exact: true }).waitFor();
  await page.waitForFunction(() => (window as any).cu28.pending.length === 1);
  await page.evaluate(() => { (window as any).cu28.hold = false; });
  await page.getByRole("button", { name: "Volver a turnos" }).click();
  await ready();
  await page.evaluate(() => { (window as any).cu28.pending.shift()(); });
  await settle(page);
  assert.equal(await save().count(), 0);
  await page.evaluate(() => { (window as any).cu28.hold = true; });
  await navigate(editPath);
  await page.waitForFunction(() => (window as any).cu28.pending.length === 1);
  await navigate("/app/personal/turnos/turno-2/editar");
  await page.waitForFunction(() => (window as any).cu28.pending.length === 2);
  await page.evaluate(() => { (window as any).cu28.pending[1](); });
  await save().waitFor();
  await page.evaluate(() => { const s = (window as any).cu28; s.hold = false; s.pending[0](); });
  await settle(page);
  assert.ok(await page.getByText("Trabajador: Luis Rojas", { exact: true }).isVisible());

  // One submission, disabled fields; success survives a failed calendar reload.
  await openOwner();
  await enter();
  await page.evaluate(() => { const s = (window as any).cu28; s.hold = true; s.failAfterEdit = true; });
  await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await page.waitForFunction(() => (window as any).cu28.pending.length === 1);
  assert.equal(await editCount(), 1);
  assert.ok(await page.getByLabel("Fecha (DD/MM/AAAA)").isDisabled());
  assert.ok(await page.getByRole("button", { name: "Volver a turnos" }).isDisabled());
  await page.evaluate(() => { const s = (window as any).cu28; s.hold = false; s.pending.shift()(); });
  await page.getByRole("heading", { name: "No se pudo cargar el calendario" }).waitFor();
  assert.ok(await page.getByText("Turno actualizado correctamente.", { exact: true }).isVisible());
  await page.evaluate(() => { (window as any).cu28.fail = false; });
  await page.getByRole("button", { name: "Reintentar" }).click();
  await ready();
  assert.ok(await page.getByText("Turno actualizado correctamente.", { exact: true }).isVisible());
  assert.equal(await editCount(), 1);

  // Success cannot be forged or replayed by navigating back with a query string.
  await navigate(editPath);
  await save().waitFor();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await ready();
  assert.equal(await page.getByText("Turno actualizado correctamente.", { exact: true }).count(), 0);
  await navigate("/app/personal/turnos?resultado=editado");
  await ready();
  assert.equal(await page.getByText("Turno actualizado correctamente.", { exact: true }).count(), 0);

  // Creation retains its own mode, active worker selection and IPC.
  await openOwner();
  await page.getByRole("combobox").selectOption("2");
  await page.getByRole("button", { name: /^Martes/ }).click();
  await page.getByRole("button", { name: "Crear turno", exact: true }).click();
  const create = page.getByRole("button", { name: "Guardar turno", exact: true });
  await create.waitFor();
  assert.equal(await page.getByRole("combobox").inputValue(), "2");
  assert.equal(await page.getByLabel("Fecha (DD/MM/AAAA)").inputValue(), isoDateToDisplay(addDaysToDateKey(week, 1)));
  await page.getByLabel("Hora inicio (HH:MM)").fill("09:00");
  await page.getByLabel("Hora termino (HH:MM)").fill("17:00");
  await create.click();
  await page.getByText("Turno creado correctamente.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).cu28.calls.filter((c: any) => c.channel === "turno:crear").length), 1);
});
