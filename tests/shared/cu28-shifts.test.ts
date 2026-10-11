import { describe, expect, it } from "vitest";
import { normalizeShiftListPayload, validateShiftListPayload } from "../../src/shared/shifts";
import { evaluateRouteAccess, getVisibleMenu } from "../../src/shared/navigation";

describe("CU28 validación de consulta y navegación", () => {
  it.each([1, "1", " 02 ", Number.MAX_SAFE_INTEGER])("acepta filtro entero %s", (value) => {
    const input = normalizeShiftListPayload({ inicioSemana: "2026-09-07", trabajadorId: value });
    expect(input.trabajadorId).toBe(Number(value));
    expect(validateShiftListPayload(input)).toEqual({});
  });

  it.each([0, -1, 1.5, "1.5", "x", "", " ", null, true, [], {}, "1e2", Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rechaza filtro inválido %j sin seleccionar todos en silencio", (value) => {
      const input = normalizeShiftListPayload({ inicioSemana: "2026-09-07", trabajadorId: value });
      expect(input.trabajadorId).not.toBeUndefined();
      expect(validateShiftListPayload(input)).toHaveProperty("trabajadorId");
    },
  );

  it("usa todos solo cuando el filtro está ausente", () => {
    const input = normalizeShiftListPayload({ inicioSemana: "2026-09-07" });
    expect(input.trabajadorId).toBeUndefined();
    expect(validateShiftListPayload(input)).toEqual({});
  });

  it.each(["2026-02-30", "", "invalid"])("rechaza fecha inválida %s", (inicioSemana) => {
    expect(validateShiftListPayload({ inicioSemana })).toHaveProperty("fecha");
  });

  it.each(["dueno", "trabajador"] as const)("muestra el calendario a %s", (role) => {
    expect(getVisibleMenu(role).some((node) => node.id === "shift-calendar")).toBe(true);
    expect(evaluateRouteAccess("/app/personal/turnos", {
      isAuthenticated: true, role, passwordChangeRequired: false,
    }).status).toBe("allow");
  });

  it("no abre la ruta de creación para un trabajador", () => {
    expect(evaluateRouteAccess("/app/personal/turnos/nuevo", {
      isAuthenticated: true, role: "trabajador", passwordChangeRequired: false,
    }).status).toBe("deny");
  });
});
