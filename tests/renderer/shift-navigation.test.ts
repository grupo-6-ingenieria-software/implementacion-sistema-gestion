import { describe, expect, it } from "vitest";
import { getWeekStartDateKey } from "../../src/shared/shifts";
import { buildShiftCalendarPath, buildShiftEditPath, getShiftCalendarContext, getShiftEditId } from "../../src/renderer/src/views/shift-navigation";

describe("CU26 V18 navigation context", () => {
  it("roundtrips the shift ID and original calendar without storing shift data", () => {
    const context = { inicioSemana: "2026-06-15", trabajadorId: 2 };
    const path = buildShiftEditPath("a/b", context);
    expect(path).toBe("/app/personal/turnos/a%2Fb/editar?inicioSemana=2026-06-15&trabajadorId=2");
    expect(getShiftEditId(path)).toBe("a/b");
    expect(getShiftCalendarContext(path)).toEqual(context);
    expect(buildShiftCalendarPath(context)).toBe("/app/personal/turnos?inicioSemana=2026-06-15&trabajadorId=2");
  });
  it.each(["", "?inicioSemana=invalid&trabajadorId=-1", "?inicioSemana=2026-02-30&trabajadorId=1.5"])("defaults invalid or absent return context: %s", (query) => {
    expect(getShiftCalendarContext(`/app/personal/turnos/x/editar${query}`))
      .toEqual({ inicioSemana: getWeekStartDateKey(), trabajadorId: undefined });
  });
  it("normalizes the calendar week and rejects unsafe worker IDs", () => {
    expect(getShiftCalendarContext("?inicioSemana=2026-06-17&trabajadorId=9007199254740992"))
      .toEqual({ inicioSemana: "2026-06-15", trabajadorId: undefined });
  });
  it("distinguishes creation from malformed edit IDs", () => {
    expect(getShiftEditId("/app/personal/turnos/nuevo")).toBeUndefined();
    expect(getShiftEditId("/app/personal/turnos/%ZZ/editar")).toBe("");
  });
});
