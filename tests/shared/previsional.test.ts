import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVISIONAL_RATES,
  hasPrevisionalFieldErrors,
  normalizePrevisionalUpdatePayload,
  validatePrevisionalRates,
} from "../../src/shared/previsional";

describe("previsional shared module", () => {
  it("exposes the RF35 default rates", () => {
    expect(DEFAULT_PREVISIONAL_RATES).toEqual({
      afp: 11.5,
      salud: 7,
      cesantia: 0.6,
    });
  });

  it("normalizes numeric and string payloads", () => {
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

  it("rejects out-of-range or non numeric percentages", () => {
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

  it("accepts boundary values 0 and 100", () => {
    const errors = validatePrevisionalRates({
      afp: 0,
      salud: 100,
      cesantia: 0.6,
    });

    expect(hasPrevisionalFieldErrors(errors)).toBe(false);
  });
});
