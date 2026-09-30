import { describe, expect, it } from "vitest";
import { buildAbsenceCreatePath, countAbsenceObservation, getAbsenceInitialRut, validateAbsenceRequest } from "../../src/shared/absence";
import { evaluateRouteAccess, getVisibleMenu } from "../../src/shared/navigation";

const now = new Date("2026-09-09T01:00:00Z"); // Still September 8 in Santiago.
const valid = { trabajadorId: 2, fecha: "2026-09-08", tipo: "justificada" };

describe("CU32 shared validation", () => {
  it.each(["justificada", "injustificada"])("accepts %s and normalizes optional observation", (tipo) => {
    expect(validateAbsenceRequest({ ...valid, tipo, observacion: "  Texto  " }, now).values).toEqual({ ...valid, tipo, observacion: "Texto" });
    expect(validateAbsenceRequest({ ...valid, observacion: "   " }, now).values?.observacion).toBeNull();
  });
  it.each([null, [], "invalid", {}])("rejects invalid payload %j", (value) => {
    expect(Object.keys(validateAbsenceRequest(value, now).errors)).toEqual(["trabajadorId", "fecha", "tipo"]);
  });
  it.each([0, -1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects worker identifier %s", (trabajadorId) => {
    expect(validateAbsenceRequest({ ...valid, trabajadorId }, now).errors.trabajadorId).toBeTruthy();
  });
  it.each(["", "0000-01-01", "2026-02-29", "2026-02-31", "2026-13-01", "08/09/2026", "2026-09-08T00:00:00Z", null])("rejects invalid date %s", (fecha) => {
    expect(validateAbsenceRequest({ ...valid, fecha }, now).errors.fecha).toBeTruthy();
  });
  it("accepts leap dates and historical registration without an extra cutoff", () => {
    expect(validateAbsenceRequest({ ...valid, fecha: "2024-02-29" }, now).errors).toEqual({});
  });
  it("compares future dates using Chile's date, not UTC", () => {
    expect(validateAbsenceRequest({ ...valid, fecha: "2026-09-09" }, now).errors.fecha).toContain("futura");
  });
  it.each(["licencia", "vacaciones", "permiso", "", 1])("rejects type %s", (tipo) => {
    expect(validateAbsenceRequest({ ...valid, tipo }, now).errors.tipo).toBeTruthy();
  });
  it("counts Unicode characters consistently and never truncates oversized text", () => {
    expect(countAbsenceObservation("  😀  ")).toBe(1);
    expect(validateAbsenceRequest({ ...valid, observacion: "😀".repeat(200) }, now).values?.observacion).toHaveLength(400);
    expect(validateAbsenceRequest({ ...valid, observacion: "a".repeat(201) }, now).errors.observacion).toBeTruthy();
    expect(validateAbsenceRequest({ ...valid, observacion: {} }, now).errors.observacion).toBeTruthy();
  });
  it("round-trips a formatted RUT through navigation", () => {
    expect(getAbsenceInitialRut(buildAbsenceCreatePath("11.111.111-1"))).toBe("11111111-1");
    expect(getAbsenceInitialRut(buildAbsenceCreatePath())).toBeUndefined();
  });
  it("shows the menu and allows the route only for the owner", () => {
    const path = buildAbsenceCreatePath("11111111-1");
    expect(evaluateRouteAccess(path, { isAuthenticated: true, role: "dueno" })).toEqual({ status: "allow" });
    expect(evaluateRouteAccess(path, { isAuthenticated: true, role: "trabajador" }).status).toBe("deny");
    expect(evaluateRouteAccess(path, { isAuthenticated: false }).status).toBe("redirect");
    expect(getVisibleMenu("dueno").some((node) => node.id === "absence-create")).toBe(true);
    expect(getVisibleMenu("trabajador").some((node) => node.id === "absence-create")).toBe(false);
  });
});
