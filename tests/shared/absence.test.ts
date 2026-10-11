import { describe, expect, it } from "vitest";
import { buildAbsenceCreatePath, countAbsenceObservation, getAbsenceInitialRut, validateAbsenceRequest } from "../../src/shared/absence";
import { evaluateRouteAccess, getVisibleMenu } from "../../src/shared/navigation";

const now = new Date("2026-09-09T01:00:00Z"); // Still September 8 in Santiago.
const valid = { trabajadorId: 2, fecha: "2026-09-08", tipo: "justificada" };

describe("validación compartida de CU32", () => {
  it.each(["justificada", "injustificada"])("acepta %s y normaliza la observación opcional", (tipo) => {
    expect(validateAbsenceRequest({ ...valid, tipo, observacion: "  Texto  " }, now).values).toEqual({ ...valid, tipo, observacion: "Texto" });
    expect(validateAbsenceRequest({ ...valid, observacion: "   " }, now).values?.observacion).toBeNull();
  });
  it.each([null, [], "invalid", {}])("rechaza payload inválido %j", (value) => {
    expect(Object.keys(validateAbsenceRequest(value, now).errors)).toEqual(["trabajadorId", "fecha", "tipo"]);
  });
  it.each([0, -1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rechaza identificador de trabajador %s", (trabajadorId) => {
    expect(validateAbsenceRequest({ ...valid, trabajadorId }, now).errors.trabajadorId).toBeTruthy();
  });
  it.each(["", "0000-01-01", "2026-02-29", "2026-02-31", "2026-13-01", "08/09/2026", "2026-09-08T00:00:00Z", null])("rechaza fecha inválida %s", (fecha) => {
    expect(validateAbsenceRequest({ ...valid, fecha }, now).errors.fecha).toBeTruthy();
  });
  it("acepta fechas bisiestas y registro histórico sin un corte adicional", () => {
    expect(validateAbsenceRequest({ ...valid, fecha: "2024-02-29" }, now).errors).toEqual({});
  });
  it("compara fechas futuras usando la fecha de Chile, no UTC", () => {
    expect(validateAbsenceRequest({ ...valid, fecha: "2026-09-09" }, now).errors.fecha).toContain("futura");
  });
  it.each(["licencia", "vacaciones", "permiso", "", 1])("rechaza tipo %s", (tipo) => {
    expect(validateAbsenceRequest({ ...valid, tipo }, now).errors.tipo).toBeTruthy();
  });
  it("cuenta caracteres Unicode de forma consistente y nunca trunca texto demasiado largo", () => {
    expect(countAbsenceObservation("  😀  ")).toBe(1);
    expect(validateAbsenceRequest({ ...valid, observacion: "😀".repeat(200) }, now).values?.observacion).toHaveLength(400);
    expect(validateAbsenceRequest({ ...valid, observacion: "a".repeat(201) }, now).errors.observacion).toBeTruthy();
    expect(validateAbsenceRequest({ ...valid, observacion: {} }, now).errors.observacion).toBeTruthy();
  });
  it("conserva un RUT formateado al pasar por la navegación", () => {
    expect(getAbsenceInitialRut(buildAbsenceCreatePath("11.111.111-1"))).toBe("11111111-1");
    expect(getAbsenceInitialRut(buildAbsenceCreatePath())).toBeUndefined();
  });
  it("muestra el menú y permite la ruta solo al dueño", () => {
    const path = buildAbsenceCreatePath("11111111-1");
    expect(evaluateRouteAccess(path, { isAuthenticated: true, role: "dueno" })).toEqual({ status: "allow" });
    expect(evaluateRouteAccess(path, { isAuthenticated: true, role: "trabajador" }).status).toBe("deny");
    expect(evaluateRouteAccess(path, { isAuthenticated: false }).status).toBe("redirect");
    expect(getVisibleMenu("dueno").some((node) => node.id === "absence-create")).toBe(true);
    expect(getVisibleMenu("trabajador").some((node) => node.id === "absence-create")).toBe(false);
  });
});
