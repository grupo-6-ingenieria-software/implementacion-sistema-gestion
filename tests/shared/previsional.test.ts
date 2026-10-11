import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVISIONAL_RATES,
  hasPrevisionalFieldErrors,
  normalizePrevisionalUpdatePayload,
  validatePrevisionalRates,
} from "../../src/shared/previsional";

describe("módulo compartido previsional", () => {
  it("expone las tasas predeterminadas de RF35", () => {
    expect(DEFAULT_PREVISIONAL_RATES).toEqual({
      afp: 11.5,
      salud: 7,
      cesantia: 0.6,
    });
  });

  it("normaliza payloads numéricos y de texto", () => {
    expect(
      normalizePrevisionalUpdatePayload({
        usuarioId: "dueno",
        afp: "12,5",
        salud: 7,
        cesantia: "0.6",
      }),
    ).toEqual({
      usuarioId: "dueno",
      afp: 12.5,
      salud: 7,
      cesantia: 0.6,
    });
  });

  it("rechaza porcentajes fuera de rango o no numéricos", () => {
    const errors = validatePrevisionalRates({
      afp: -1,
      salud: 101,
      cesantia: Number.NaN,
    });

    expect(hasPrevisionalFieldErrors(errors)).toBe(true);
    expect(errors.afp).toBeDefined();
    expect(errors.salud).toBeDefined();
    expect(errors.cesantia).toBeDefined();
  });

  it("acepta los valores límite 0 y 100", () => {
    const errors = validatePrevisionalRates({
      afp: 0,
      salud: 100,
      cesantia: 0.6,
    });

    expect(hasPrevisionalFieldErrors(errors)).toBe(false);
  });
});
