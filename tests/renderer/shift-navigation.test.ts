import { describe, expect, it } from "vitest";
import { getWeekStartDateKey } from "../../src/shared/shifts";
import { buildShiftCalendarPath, buildShiftEditPath, getShiftCalendarContext, getShiftEditId } from "../../src/renderer/src/views/shift-navigation";

describe("contexto de navegación CU26 V18", () => {
  it("conserva ida y vuelta del ID del turno y del calendario original sin almacenar datos del turno", () => {
    const context = { inicioSemana: "2026-06-15", trabajadorId: 2 };
    const path = buildShiftEditPath("a/b", context);
    expect(path).toBe("/app/personal/turnos/a%2Fb/editar?inicioSemana=2026-06-15&trabajadorId=2");
    expect(getShiftEditId(path)).toBe("a/b");
    expect(getShiftCalendarContext(path)).toEqual(context);
    expect(buildShiftCalendarPath(context)).toBe("/app/personal/turnos?inicioSemana=2026-06-15&trabajadorId=2");
  });
  it.each(["", "?inicioSemana=invalid&trabajadorId=-1", "?inicioSemana=2026-02-30&trabajadorId=1.5"])("usa valores por defecto ante contexto de retorno inválido o ausente: %s", (query) => {
    expect(getShiftCalendarContext(`/app/personal/turnos/x/editar${query}`))
      .toEqual({ inicioSemana: getWeekStartDateKey(), trabajadorId: undefined });
  });
  it("normaliza la semana del calendario y rechaza IDs de trabajador no seguros", () => {
    expect(getShiftCalendarContext("?inicioSemana=2026-06-17&trabajadorId=9007199254740992"))
      .toEqual({ inicioSemana: "2026-06-15", trabajadorId: undefined });
  });
  it("distingue la creación de IDs de edición malformados", () => {
    expect(getShiftEditId("/app/personal/turnos/nuevo")).toBeUndefined();
    expect(getShiftEditId("/app/personal/turnos/%ZZ/editar")).toBe("");
  });
});
