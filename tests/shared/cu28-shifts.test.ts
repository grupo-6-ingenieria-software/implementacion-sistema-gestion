import { describe, expect, it } from "vitest";
import { normalizeShiftListPayload, validateShiftListPayload } from "../../src/shared/shifts";
import { evaluateRouteAccess, getVisibleMenu } from "../../src/shared/navigation";

describe("CU28 query validation and navigation", () => {
  it.each([1, "1", " 02 ", Number.MAX_SAFE_INTEGER])("accepts integer filter %s", (value) => {
    const input = normalizeShiftListPayload({ inicioSemana: "2026-09-07", trabajadorId: value });
    expect(input.trabajadorId).toBe(Number(value));
    expect(validateShiftListPayload(input)).toEqual({});
  });

  it.each([0, -1, 1.5, "1.5", "x", "", " ", null, true, [], {}, "1e2", Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid filter %j without silently selecting all", (value) => {
      const input = normalizeShiftListPayload({ inicioSemana: "2026-09-07", trabajadorId: value });
      expect(input.trabajadorId).not.toBeUndefined();
      expect(validateShiftListPayload(input)).toHaveProperty("trabajadorId");
    },
  );

  it("uses all only when the filter is absent", () => {
    const input = normalizeShiftListPayload({ inicioSemana: "2026-09-07" });
    expect(input.trabajadorId).toBeUndefined();
    expect(validateShiftListPayload(input)).toEqual({});
  });

  it.each(["2026-02-30", "", "invalid"])("rejects invalid date %s", (inicioSemana) => {
    expect(validateShiftListPayload({ inicioSemana })).toHaveProperty("fecha");
  });

  it.each(["dueno", "trabajador"] as const)("shows the calendar to %s", (role) => {
    expect(getVisibleMenu(role).some((node) => node.id === "shift-calendar")).toBe(true);
    expect(evaluateRouteAccess("/app/personal/turnos", {
      isAuthenticated: true, role, passwordChangeRequired: false,
    }).status).toBe("allow");
  });

  it("does not open the create route for a worker", () => {
    expect(evaluateRouteAccess("/app/personal/turnos/nuevo", {
      isAuthenticated: true, role: "trabajador", passwordChangeRequired: false,
    }).status).toBe("deny");
  });
});
