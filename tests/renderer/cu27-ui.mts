import assert from "node:assert/strict";
import { join } from "node:path";
import { withShiftUi } from "./shift-ui-fixture.mjs";
import { getWeekStartDateKey, isoDateToDisplay } from "../../src/shared/shifts";

await withShiftUi("cu27", async (page, url, output) => {
  const ready = () => page.getByRole("heading", { name: "Calendario semanal de turnos" }).waitFor();
  const card = (hours = "08:00 - 16:00") => page.getByRole("button", { name: `Ana Soto ${hours}` });
  const openOwner = async () => { await page.goto(`${url}?role=dueno`); await ready(); };
  const remove = () => page.getByRole("button", { name: "Eliminar turno", exact: true });
  const confirm = () => page.getByRole("button", { name: "Confirmar eliminacion", exact: true });
  const deleteCount = () => page.evaluate(() => (window as any).cu28.calls.filter((c: any) => c.channel === "turno:eliminar").length);

  await openOwner();
  await card().click();
  await remove().click();
  await page.getByText(`Ana Soto, ${isoDateToDisplay(getWeekStartDateKey())}, de 08:00 a 16:00.`, { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "confirmacion.png"), fullPage: true });
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await deleteCount(), 0);
  assert.ok(await card().isVisible());
  assert.equal(await page.evaluate(() => (window as any).cu28.missingShiftIds.length), 0);

  // Main rejects state changed after the selection/confirmation precheck.
  for (const message of ["El turno ya inicio", "El turno tiene asistencia registrada"]) {
    await card().click();
    await remove().click();
    await page.evaluate((value) => { (window as any).cu28.mutationError = value; }, message);
    await confirm().click();
    await page.getByText(message, { exact: true }).waitFor();
    assert.ok(await card().isVisible());
    assert.equal(await page.getByText("Turno eliminado correctamente.", { exact: true }).count(), 0);
  }

  // Full V17 -> V18 -> V17 -> deletion flow, with a stateful IPC simulation.
  await openOwner();
  await card().click();
  await page.getByRole("button", { name: "Editar turno", exact: true }).click();
  const save = page.getByRole("button", { name: "Guardar cambios", exact: true });
  await save.waitFor();
  await page.getByLabel("Hora inicio (HH:MM)").fill("09:00");
  await page.getByLabel("Hora termino (HH:MM)").fill("17:00");
  await save.click();
  await ready();
  await card("09:00 - 17:00").click();
  await remove().click();
  await page.getByText(`Ana Soto, ${isoDateToDisplay(getWeekStartDateKey())}, de 09:00 a 17:00.`, { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).cu28.hold = true; });
  await confirm().evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await page.waitForFunction(() => (window as any).cu28.pending.length === 1);
  assert.equal(await deleteCount(), 1);
  assert.ok(await page.getByRole("button", { name: "Cancelar", exact: true }).isDisabled());
  assert.ok(await page.getByRole("button", { name: "Cerrar", exact: true }).isDisabled());
  await page.evaluate(() => { const s = (window as any).cu28; s.hold = false; s.pending.shift()(); });
  await page.getByText("Turno eliminado correctamente.", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.body.textContent?.includes("Actualizando calendario..."));
  assert.equal(await card("09:00 - 17:00").count(), 0);
  assert.ok(await page.getByRole("button", { name: "Luis Rojas 08:00 - 16:00" }).isVisible());
  assert.equal(await page.getByRole("button", { name: "Cerrar", exact: true }).count(), 0);
  assert.ok(await page.evaluate(() => (window as any).cu28.calls.some((c: any) => c.channel === "turno:eliminar" && c.payload.confirmacion === true)));
  await page.screenshot({ path: join(output, "eliminado.png"), fullPage: true });

  // Failed reload cannot erase a confirmed deletion or cause a repeated DELETE.
  await openOwner();
  await card().click();
  await remove().click();
  await page.evaluate(() => { (window as any).cu28.failAfterDelete = true; });
  await confirm().click();
  await page.getByRole("heading", { name: "No se pudo cargar el calendario" }).waitFor();
  assert.ok(await page.getByText("Turno eliminado correctamente.", { exact: true }).isVisible());
  await page.evaluate(() => { (window as any).cu28.fail = false; });
  await page.getByRole("button", { name: "Reintentar" }).click();
  await ready();
  assert.equal(await card().count(), 0);
  assert.equal(await deleteCount(), 1);

  await page.goto(url);
  await ready();
  await card().click();
  assert.equal(await remove().count(), 0);
  assert.equal(await confirm().count(), 0);
  assert.equal(await deleteCount(), 0);
});
